'use strict';

 // debug = () => {}; // REL_ONLY
{
  let listenersMap = new Map();
  let backlog = new Set();
  var ns = {
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
      this.perms.DEFAULT = DEFAULT;
      if(!this.perms.CURRENT) this.perms.CURRENT = DEFAULT;
      
      // ugly hack: since now we use registerContentScript instead of the
      // filterRequest dynamic script injection hack, we use top.name
      // to store per-tab information. We don't want web content to
      // mess with it, though, so we wrap it around auto-hiding accessors
      this.perms.MARKER = MARKER;
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
          this.perms.tabInfo = JSON.parse(tabInfoMatch[1]);
        } catch (e) {
          error(e);
        }
      }
      
      if (!this.perms.DEFAULT || this.perms.tabInfo.unrestricted) {
        this.allows = () => true;
      }
      ns.fire("perms");
    },
    perms: { DEFAULT: null, CURRENT: null, tabInfo: {}, MARKER: "" },
    allows(cap) {
      let perms = this.perms.CURRENT; 
      return perms  && perms.capabilities.includes(cap);
    },
    getWindowName() {
      return top !== window || !this.perms.MARKER ? window.name
        : window.name.split(this.perms.MARKER + ",").pop();
    }
  }
}

var canScript = true, shouldScript = false;

let now = () => performance.now() + performance.timeOrigin;

function createHTMLElement(name) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", name);
}

function probe() {
  try {
    debug("Probing execution...");
    let s = document.createElement("script"); 
    s.textContent = ";"; 
    document.documentElement.appendChild(s);
    s.remove();
  } catch(e) {
    debug(e);
  }
}

var _ = browser.i18n.getMessage;

var embeddingDocument = false;

var seen = {
  _map: new Map(),
  _list: null,
  record(event) {
    let key = event.request.key;
    if (this._map.has(key)) return;
    this._map.set(key, event);
    this._list = null;
  },
  get list() {
    return this._list || (this._list = [...this._map.values()]);
  }
}

Messages.addHandler({
  seen(event) {
    let {allowed, policyType, request, ownFrame} = event;
    if (window.top === window) {
      seen.record(event);
    }
    if (ownFrame) {
      init();
      if (!allowed && PlaceHolder.canReplace(policyType)) {
        request.embeddingDocument = embeddingDocument;
        PlaceHolder.create(policyType, request);
      }
    }
  },
  collect(event) {
    let list = seen.list;
    debug("COLLECT", list);
    return list;
  }
});

if (document.readyState !== "complete") {
  let pageshown = e => {
    removeEventListener("pageshow", pageshown);
    init();
  };
  addEventListener("pageshow", pageshown);
} else {
  init(true);
}
let notifyPage = async () => {
  debug("Page %s shown, %s", document.URL, document.readyState);
  if (document.readyState === "complete") {
    try {
      await Messages.send("pageshow", {seen: seen.list, canScript});
      return true;
    } catch (e) {
      debug(e);
    }
  }
  return false;
}

var queryingStatus = false;

function reload(noCache = false) {
  init = () => {};
  location.reload(noCache);
}

async function init(oldPage = false) {
  if (queryingStatus) return;
  if (!document.URL.startsWith("http")) {
    return;
  }
  queryingStatus = true;

  debug(`init() called in document %s, contentType %s readyState %s, frameElement %o`,
    document.URL, document.contentType, document.readyState, window.frameElement && frameElement.data);
  
  try {
    ({canScript, shouldScript} = await Messages.send("queryDocStatus", {url: document.URL}));
    debug(`document %s, canScript=%s, shouldScript=%s, readyState %s`, document.URL, canScript, shouldScript, document.readyState);
    if (canScript) {
      if (oldPage) {
        probe();
        setTimeout(() => init(), 200);
        return;
      }
      if (!shouldScript && 
          (document.readyState !== "complete" || 
            now() - performance.timing.domContentLoadedEventStart < 5000)) {
        // Something wrong: scripts can run, permissions say they shouldn't.
        // Was webRequest bypassed by caching/session restore/service workers?
        window.stop();
        let noCache = !!navigator.serviceWorker.controller;
        if (noCache) {
           for (let r of await navigator.serviceWorker.getRegistrations()) {
             await r.unregister();
           }
        }
        debug("Reloading %s (%s)", document.URL, noCache  ? "no cache" : "cached");
        reload(noCache);
        return;
      }
    }
    init = () => {};
  } catch (e) {
    debug("Error querying docStatus", e);
    if (!oldPage &&
      /Receiving end does not exist/.test(e.message)) {
      // probably startup and bg page not ready yet, hence no CSP: reload!
      debug("Reloading", document.URL);
      reload();
    } else {
      setTimeout(() => init(oldPage), 100);
    }
    return;
  } finally {
    queryingStatus = false;
  }

  if (!canScript) onScriptDisabled();
  seen.record({
      request: {
        key: "noscript-probe",
        url: document.URL,
        documentUrl: document.URL,
        type: window === window.top ? "main_frame" : "script",
      },
      allowed: canScript
    }
  );

  debug(`Loading NoScript in document %s, scripting=%s, readyState %s`,
    document.URL, canScript, document.readyState);

  if (/application|video|audio/.test(document.contentType)) {
    debug("Embedding document detected");
    embeddingDocument = true;
    window.addEventListener("pageshow", e => {
      debug("Active content still in document %s: %o", document.url, document.querySelectorAll("embed,object,video,audio"));
    }, true);
    // document.write("<plaintext>");
  }
  notifyPage();
  addEventListener("pageshow", notifyPage);
}
