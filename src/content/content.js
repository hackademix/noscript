'use strict';
// debug = () => {}; // REL_ONLY

var _ = browser.i18n.getMessage;

function createHTMLElement(name) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", name);
}

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
      if (!allowed && PlaceHolder.canReplace(policyType)) {
        request.embeddingDocument = ns.embeddingDocument;
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


debug(`Loading NoScript in document %s, scripting=%s, readyState %s`,
  document.URL, ns.canScript, document.readyState);

var notifyPage = async () => {
  debug("Page %s shown, %s", document.URL, document.readyState);
  if (document.readyState === "complete") {
    try {
      if (!("canScript" in ns)) {
        let childPolicy = await Messages.send("fetchChildPolicy", {url: document.URL, contextUrl: top.location.href});
        ns.config.CURRENT = childPolicy.CURRENT;
        ns.setup(childPolicy.DEFAULT, childPolicy.MARKER);
        return;
      }

      await Messages.send("pageshow", {seen: seen.list, canScript: ns.canScript});
      return true;
    } catch (e) {
      debug(e);
      if (/Receiving end does not exist/.test(e.message)) {
        window.setTimeout(notifyPage, 2000);
      }
    }
  }
  return false;
}

notifyPage();

window.addEventListener("pageshow", notifyPage);

ns.on("capabilities", () => {
  seen.record({
      request: {
        key: "noscript-probe",
        url: document.URL,
        documentUrl: document.URL,
        type: window === window.top ? "main_frame" : "script",
      },
      allowed: ns.canScript
    });
  
  if (!ns.canScript) {

    if (!!navigator.serviceWorker.controller) {
      addEventListener("beforescriptexecute", e => e.preventDefault());
        (async () => {
          for (let r of await navigator.serviceWorker.getRegistrations()) {
            await r.unregister();
          }
        })();
    }

    if (document.readyState !== "loading") onScriptDisabled();
    window.addEventListener("DOMContentLoaded", onScriptDisabled);
  }
  
  notifyPage();
});
