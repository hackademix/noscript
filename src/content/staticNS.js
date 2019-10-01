'use strict';
{
  let listenersMap = new Map();
  let backlog = new Set();

  let stopAndReload = beforeReloading => {
    debug("Should I reload? %o, now: %s", performance.now())
    if (performance.now() > 10000) {
      debug("Won't reload.");
      return;
    }
    stop();
    setTimeout(() => {
      debug("Reloading...");
      if (typeof beforeReloading === "function") {
        beforeReloading();
      }
      location.reload();
    }, 1000)
  };

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
      debug(`Fetching policy from document %s, readyState %s, content %s`,
        document.URL, document.readyState, document.documentElement.outerHTML);
      let url = document.URL;
      let isFileUrl = url.startsWith("file:");
      if (isFileUrl) {
        let cookie = "noscript.startupFileReloaded=true";
        if (!document.cookie.split(/\s*;\s*/).includes(cookie)) {
          stopAndReload(() => document.cookie = cookie);
        }
      }

      let policy = browser.runtime.sendSyncMessage(
        {id: "fetchPolicy", url, contextUrl: url});

      debug("Fetched %o, readyState %s", policy, document.readyState);
      if (!policy) {
        debug("Could not fetch policy!");
        if (isFileUrl && !sessionStorage.__noScriptFallbackReload__) {
          sessionStorage.__noScriptFallbackReload__ = "true";
          stopAndReload();
        }
        // let's try asynchronously
        (async () => {
          this.setup(await Messages.send("fetchPolicy", {url, contextUrl: url}));
        })();
        return false;
      } else if (policy.fallback) {
        stopAndReload();
      }
      this.setup(policy);
      return true;
    },

    setup(policy) {
      debug("%s, %s, %o", document.URL, document.readyState, policy);
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
