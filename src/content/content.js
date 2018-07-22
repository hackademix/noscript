'use strict';

 // debug = () => {}; // XPI_ONLY

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

var canScript = true;

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
let notifyPage = () => {
  if (document.readyState === "complete") {
    browser.runtime.sendMessage({type: "pageshow", seen, canScript});
    return true;
  }
  return false;
}

var queryingCanScript = false;
async function init(oldPage = false) {
  if (queryingCanScript) return;
  queryingCanScript = true;
  debug(`NoScript init() called in document %s, scripting=%s, content type %s readyState %s`,
    document.URL, canScript, document.contentType, document.readyState);
  
  try {
    canScript = document.URL === "about:blank" || await browser.runtime.sendMessage({type: "canScript"});
    if (oldPage && canScript) {
      probe();
      setTimeout(() => init(), 100);
      return;
    }
    init = () => {};
    debug("canScript:", canScript);
  } catch (e) {
    debug("Error querying canScript", e);
    if (document.readyState !== "complete" &&
      /Receiving end does not exist/.test(e.message)) {
      window.location.reload(false);
    } else {
      setTimeout(() => init(oldPage), 100);
    }
    return;
  } finally {
    queryingCanScript = false;
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

  debug(`Loading NoScript in document %s, scripting=%s, content type %s readyState %s`,
    document.URL, canScript, document.contentType, document.readyState);

  if (/application|video|audio/.test(document.contentType)) {
    debug("Embedding document detected");
    embeddingDocument = true;
    window.addEventListener("pageshow", e => {
      debug("Active content still in document %s: %o", document.url, document.querySelectorAll("embed,object,video,audio"));
    }, true);
    // document.write("<plaintext>");
  }
  notifyPage() || addEventListener("pageshow", notifyPage);
};
