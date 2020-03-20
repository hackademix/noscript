'use strict';
// debug = () => {}; // REL_ONLY
function _(...args) {
  let fakeLang = navigator.language === "en-US" &&
                  browser.i18n.getUILanguage() !== "en-US";
  return (_ = (template, ...substitutions) => {
        let [key, defTemplate] = template.split("|");
        return fakeLang
          ? (defTemplate || key).replace(/\$([1-9])/g,
              (m, p) => substitutions[parseInt(p) - 1] || "$" + p)
          : browser.i18n.getMessage(template, ...substitutions);
      })(...args);
}

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
    let {allowed, policyType, request, ownFrame, serviceWorker} = event;
    if (serviceWorker) {
      for (let e of seen.list) {
        let {request} = e;
        if (e.serviceWorker === serviceWorker ||
            (request.type === "main_frame" || request.type === "sub_frame") &&
             new URL(request.url).origin === serviceWorker) {
          seen.record(event);
          break;
        }
      }
      return;
    }
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
      await Messages.send("pageshow", {seen: seen.list, canScript: ns.canScript});
      return true;
    } catch (e) {
      debug(e);
      if (Messages.isMissingEndpoint(e)) {
        window.setTimeout(notifyPage, 2000);
      }
    }
  }
  return false;
}

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

    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
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

ns.fetchPolicy();
notifyPage();

addEventListener("DOMContentLoaded", e => {
  if (ns.canScript) return;
  for (let m of document.querySelectorAll("meta[http-equiv=refresh]")) {
    if (/^[^,;]*[,;]\W*url[^=]*=[^!#$%&'()*+,/:;=?@[\]\w.,~-]*data:/i.test(m.getAttribute("content"))) {
      let url = m.getAttribute("content").replace(/.*?(?=data:)/i, "");
      log(`Blocking refresh to ${url}`);
      window.stop();
    }
  }
});
