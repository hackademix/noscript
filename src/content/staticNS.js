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
    
    setup(DEFAULT, MARKER) {
      this.config.DEFAULT = DEFAULT;
      if(!this.config.CURRENT) this.config.CURRENT = DEFAULT;

      // ugly hack: since now we use registerContentScript instead of the
      // filterRequest dynamic script injection hack, we use top.name
      // to store per-tab information. We don't want web content to
      // mess with it, though, so we wrap it around auto-hiding accessors
      this.config.MARKER = MARKER;
      let eraseTabInfoRx = new RegExp(`[^]*${MARKER},?`);
      if (eraseTabInfoRx.test(top.name)) {
        let _name = top.name;
        let tabInfoRx = new RegExp(`^${MARKER}\\[([^]*?)\\]${MARKER},`);
        if (top === window) { // wrap to hide
          Reflect.defineProperty(top.wrappedJSObject, "name", {
            get: exportFunction(() => top.name.replace(eraseTabInfoRx, ""), top.wrappedJSObject),
            set: exportFunction(value => {
              let preamble = top.name.match(tabInfoRx);
              top.name = `${preamble && preamble[0] || ""}${value}`;
              return value;
            }, top.wrappedJSObject)
          });
        }
        let tabInfoMatch = _name.match(tabInfoRx);
        if (tabInfoMatch) try {
          this.config.tabInfo = JSON.parse(tabInfoMatch[1]);
        } catch (e) {
          error(e);
        }
      }
      
      if (!this.config.DEFAULT || this.config.tabInfo.unrestricted) {
        this.allows = () => true;
        this.capabilities =  Object.assign(
          new Set(["script"]), { has() { return true; } });
      } else {
        let perms = this.config.CURRENT;
        this.capabilities = new Set(perms.capabilities);
        new DocumentCSP(document).apply(this.capabilities, this.embeddingDocument);
      }
      
      this.canScript = this.allows("script");
      this.fire("capabilities");
    },
    config: { DEFAULT: null, CURRENT: null, tabInfo: {}, MARKER: "" },
        
    allows(cap) {
      return this.capabilities && this.capabilities.has(cap);
    },
    
    getWindowName() {
      let marker = this.config.MARKER;
      return (top === window && marker) ? 
          window.name.split(`${marker},`).pop()
          : window.name;
    }
  };
  
  if (this.ns) {
    this.ns.merge(ns);
  } else {
    this.ns = ns;
  }
}
