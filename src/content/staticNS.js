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

      debug(`Fetching policy from document %s, readyState %s`,
        url, document.readyState
        //, document.domain, document.baseURI, window.isSecureContext // DEV_ONLY
      );

      if (/^(ftp|file):/.test(url)) { // ftp: or file: - no CSP headers yet
        if (this.syncFetchPolicy) {
          this.syncFetchPolicy();
        } else { // additional content scripts not loaded yet
          log("Waiting for syncFetchPolicy to load...");
          this.pendingFetchPolicy = true;
          return;
        }
      } else {
        // CSP headers have been already provided by webRequest, we are not in a hurry...
        if (/^(javascript|about):/.test(url)) {
          url = document.readyState === "loading"
          ? document.baseURI
          : `${window.isSecureContext ? "https" : "http"}://${document.domain}`;
          debug("Fetching policy for actual URL %s (was %s)", url, document.URL);
        }
        let asyncFetch = async () => {
          try {
            policy = await Messages.send("fetchChildPolicy", {url, contextUrl: url});
          } catch (e) {
            error(e, "Error while fetching policy");
          }
          if (policy === undefined) {
            let delay = 300;
            log(`Policy was undefined, retrying in ${delay}ms...`);
            setTimeout(asyncFetch, delay);
            return;
          }
          this.setup(policy);
        }
        asyncFetch();
        return;
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
  };

  this.ns = this.ns ? Object.assign(this.ns, ns) : ns;
}
