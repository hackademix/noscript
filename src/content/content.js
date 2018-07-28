'use strict';

 // debug = () => {}; // XPI_ONLY
 
var canScript = true, shouldScript = false;
 
function createHTMLElement(name) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", name);
}

function probe() {
  try {
    debug("Probing execution...");
    let s = document.createElement("script"); 
    s.textContent=";"; 
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

var handlers = {

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
};

browser.runtime.onMessage.addListener(async event => {
  if (event.type in handlers) {
    debug("Received message", event);
    return handlers[event.type](event);
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
      await browser.runtime.sendMessage({type: "pageshow", seen: seen.list, canScript});
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
    ({canScript, shouldScript} = await browser.runtime.sendMessage({type: "docStatus", url: document.URL}));
    debug(`document %s, canScript=%s, shouldScript=%s, readyState %s`, document.URL, canScript, shouldScript, document.readyState);
    if (canScript) {
      if (oldPage) {
        probe();
        setTimeout(() => init(), 200);
        return;
      }
      if (!shouldScript) {
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
