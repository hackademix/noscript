'use strict';
{
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

    async fetchPolicy() {
        let policy = await Messages.send("fetchChildPolicy", {url: document.URL});
        if (!policy) {
          debug(`No answer to fetchChildPolicy message. This should not be happening.`);
          return false;
        }
        this.setup(policy.permissions, policy.MARKER, true);
        return true;
    },

    setup(permissions, MARKER, fetched = false) {
      this.config.permissions = permissions;

      // ugly hack: since now we use registerContentScript instead of the
      // filterRequest dynamic script injection hack, we use a session cookie
      // to store per-tab information,  erasing it as soon as we see it
      // (before any content can access it)

      let checkUnrestricted = challenge => sha256(`${MARKER}:${challenge}`);

      if ((this.config.MARKER = MARKER) && permissions) {
        let cookieRx = new RegExp(`(?:^|;\\s*)(${MARKER}(?:_\\d+){2})=([^;]*)`);
        let match = document.cookie.match(cookieRx);
        if (match) {
          let [cookie, cookieName, cookieValue] = match;
          // delete cookie NOW
          document.cookie = `${cookieName}=;expires=${new Date(Date.now() - 31536000000).toGMTString()}`;
          try {
            this.config.tabInfo = JSON.parse(decodeURIComponent(cookieValue));
          } catch (e) {
            error(e);
          }
        } else if (window !== window.top) {
          // The cookie hack won't work for non-HTTP subframes (issue #48),
          // or the cookie might have been deleted in a race condition,
          // so here we try to check the parent
          let checkParent = parent.wrappedJSObject.checkNoScriptUnrestricted;
          if (typeof checkParent  === "function") {
            try {
              let challenge = uuid();
              let unrestricted = checkParent(challenge) === checkUnrestricted(challenge);
              this.config.tabInfo = {unrestricted, inherited: true};
            } catch (e) {
              debug("Exception thrown while checking parent unrestricted tab marker. Something fishy going on...")
              error(e);
            }
          }
        }
      }

      if (!this.config.permissions || this.config.tabInfo.unrestricted) {
        exportFunction(checkUnrestricted, window, {defineAs: "checkNoScriptUnrestricted"});
        debug("%s is loading unrestricted by user's choice (%o).", document.URL, this.config);
        this.allows = () => true;
        this.capabilities =  Object.assign(
          new Set(["script"]), { has() { return true; } });
      } else {
        if (!fetched) {
          let hostname = window.location.hostname;
          if (hostname && hostname.startsWith("[")) {
            // WebExt match patterns don't seem to support IPV6 (Firefox 63)...
            debug("Ignoring child policy setup parameters for IPV6 address %s, forcing IPC...", hostname);
            this.fetchPolicy();
            return;
          }
        }
        let perms = this.config.permissions;
        this.capabilities = new Set(perms.capabilities);
        new DocumentCSP(document).apply(this.capabilities, this.embeddingDocument);
      }

      this.canScript = this.allows("script");
      this.fire("capabilities");
    },
    config: { permissions: null, tabInfo: {}, MARKER: "" },

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
