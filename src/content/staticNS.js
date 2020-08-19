{
  'use strict';
  let listenersMap = new Map();
  let backlog = new Set();
  let documentCSP = new DocumentCSP(document);
  documentCSP.removeEventAttributes();
  let ns = {
    debug: true, // DEV_ONLY
    get embeddingDocument() {
      delete this.embeddingDocument;
      return this.embeddingDocument = CSP.isEmbedType(document.contentType);
    },
    on(eventName, listener) {
      let listeners = listenersMap.get(eventName);
      if (!listeners) listenersMap.set(eventName, listeners = new Set());
      listeners.add(listener);
      if (backlog.has(eventName)) this.fire(eventName, listener);
    },
    detach(eventName, listener) {
      let listeners = listenersMap.get(eventName);
      if (listeners) listeners.delete(listener);
    },
    fire(eventName, listener = null) {
      if (listener) {
        listener({type:eventName, source: this});
        return;
      }
      let listeners = listenersMap.get(eventName);
      if (listeners) {
        for (let l of listeners) {
          this.fire(eventName, l);
        }
      }
      backlog.add(eventName);
    },

    fetchPolicy() {
      let url = document.URL;
      debug(`Fetching policy from document %s, readyState %s`,
        url, document.readyState
        , document.documentElement.outerHTML, // DEV_ONLY
        document.domain, document.baseURI, window.isSecureContext // DEV_ONLY
      );

      if (!/^(?:file|ftp|https?):/i.test(url)) {
        if (/^(javascript|about):/.test(url)) {
          url = document.readyState === "loading"
          ? document.baseURI
          : `${window.isSecureContext ? "https" : "http"}://${document.domain}`;
          debug("Fetching policy for actual URL %s (was %s)", url, document.URL);
        }
        (async () => {
          let policy;
          try {
            policy = await Messages.send("fetchChildPolicy", {url, contextUrl: url});
          } catch (e) {
            console.error("Error while fetching policy", e);
          }
          if (policy === undefined) {
            log("Policy was undefined, retrying in 1/2 sec...");
            setTimeout(() => this.fetchPolicy(), 500);
            return;
          }
          this.setup(policy);
        })();
        return;
      }

      let originalState = document.readyState;
      let syncLoad = UA.isMozilla && /^(?:ftp|file):/.test(url);
      let localPolicyKey;
      if (syncLoad && originalState !== "complete") {
        localPolicyKey = `ns.policy.${url}|${browser.runtime.getURL("")}`;

        let [name, localPolicy] = window.name.split(localPolicyKey);
        window.name = name;
        if (localPolicy) {
          debug("Falling back to localPolicy", localPolicy);
          try {
            this.setup(JSON.parse(localPolicy));
          } catch(e) {
            error(e, "Falling back: could not setup local policy", localPolicy);
            localPolicyKey = null;
            this.setup(null);
          }
          return;
        } else {
          addEventListener("beforescriptexecute", e => {
            console.log("Blocking early script", e.target);
            e.preventDefault();
          });
          stop();
        }
      }

      let setup = policy => {
        debug("Fetched %o, readyState %s", policy, document.readyState); // DEV_ONLY
        this.setup(policy);
        if (syncLoad && originalState !== "complete") {
          window.name = [window.name, JSON.stringify(this.policy)].join(localPolicyKey);
          location.reload(false);
          return;
        }
      }

      for (let attempts = 3; attempts-- > 0;) {
        try {
          browser.runtime.sendSyncMessage(
            {id: "fetchPolicy", url, contextUrl: url},
            setup);
          break;
        } catch (e) {
          if (!Messages.isMissingEndpoint(e) || document.readyState === "complete") {
            error(e);
            break;
          }
          error("Background page not ready yet, retrying to fetch policy...")
        }
      }

    },

    setup(policy) {
      debug("%s, %s, %o", document.URL, document.readyState, policy);
      if (!policy) {
        policy = {permissions: {capabilities: []}, localFallback: true};
      }
      this.policy = policy;

      if (!policy.permissions || policy.unrestricted) {
        this.allows = () => true;
        this.capabilities =  Object.assign(
          new Set(["script"]), { has() { return true; } });
      } else {
        let perms = policy.permissions;
        this.capabilities = new Set(perms.capabilities);
        documentCSP.apply(this.capabilities, this.embeddingDocument);
      }
      documentCSP.restoreEventAttributes();
      this.canScript = this.allows("script");
      this.fire("capabilities");
    },

    policy: null,

    allows(cap) {
      return this.capabilities && this.capabilities.has(cap);
    },

    getWindowName() {
      return window.name;
    }
  };

  if (this.ns) {
    this.ns.merge(ns);
  } else {
    this.ns = ns;
  }
}
