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
      // filterRequest dynamic script injection hack, we use window.name
      // to store per-tab information. We don't want web content to
      // mess with it, though, so we wrap it around auto-hiding accessors

      if (this.config.MARKER = MARKER) {

        let tabInfoRx = new RegExp(`^${MARKER}\\[([^]*?)\\]${MARKER},`);
        let name = window.name;
        try {
          name = top.name;
        } catch(e) {
          // won't work cross-origin
        }
        let tabInfoMatch = name.match(tabInfoRx);
        if (tabInfoMatch) {
          try {
            this.config.tabInfo = JSON.parse(tabInfoMatch[1]);
          } catch (e) {
            error(e);
          }
        }
        let splitter = `${MARKER},`;
        this.getWindowName = () => window.name.split(splitter).pop();
        Reflect.defineProperty(window.wrappedJSObject, "name", {
          get: exportFunction(() => this.getWindowName(), window.wrappedJSObject),
          set: exportFunction(value => {
            let tabInfoMatch = window.name.match(tabInfoRx);
            window.name = tabInfoMatch ? `${tabInfoMatch[0]}${value}` : value;
            return value;
          }, window.wrappedJSObject)
        });
      }
      if (!this.config.permissions || this.config.tabInfo.unrestricted) {
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
