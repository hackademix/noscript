{
  'use strict';
  let listenersMap = new Map();
  let backlog = new Set();

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
      if (url.startsWith("http")) {
        (async () => {
          this.setup(await Messages.send("fetchChildPolicy", {url, contextUrl: url}));
        })();
        return;
      }
      debug(`Fetching policy from document %s, readyState %s, content %s`,
        url, document.readyState, document.documentElement.outerHTML);
      let originalState = document.readyState;
      let blockedScripts = [];

      addEventListener("beforescriptexecute", e => {
        // safety net for syncrhonous load on Firefox
        if (!this.canScript) {
          e.preventDefault();
          let script = e.target;
          blockedScripts.push(script)
          log("Some script managed to be inserted in the DOM while fetching policy, blocking it.\n", script);
        }
      }, true);

      let policy = null;

      let setup = policy => {
        debug("Fetched %o, readyState %s", policy, document.readyState); // DEV_ONLY
        this.setup(policy);
        if (this.canScript && blockedScripts.length && originalState === "loading") {
          log("Blocked some scripts on %s even though they are actually permitted by policy.", url)
          // something went wrong, e.g. with session restore.
          for (let s of blockedScripts) {
            // reinsert the script
            s.replace(s.cloneNode(true));
          }
        }
      }

      for (;;) {
        try {
          policy = browser.runtime.sendSyncMessage(
            {id: "fetchPolicy", url, contextUrl: url}, setup);
          break;
        } catch (e) {
          if (!Messages.isMissingEndpoint(e)) {
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
        new DocumentCSP(document).apply(this.capabilities, this.embeddingDocument);
      }

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
