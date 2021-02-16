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
  recordAll(events) {
    this._map.clear();
    for (let e of events) this.record(e);
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
  allSeen(event) {
    seen.recordAll(event.seen);
    notifyPage();
  },
  collect(event) {
    let list = seen.list;
    debug("COLLECT", list);
    return list;
  },
  store(event) {
    if (document.URL !== event.url) return;
    let {data} = event;
    let attr = sha256(data.concat(Math.random()));
    document.documentElement.dataset[attr] = data;
    return attr;
  },
  retrieve(event) {
    if (document.URL !== event.url) return;
    let {attr, preserve} = event;
    if (!attr) {
      // legacy, < 11.0.39rc8
      return document.documentElement.lastChild.textContent;
    }
    let data = document.documentElement.dataset[attr];
    if (!preserve) delete document.documentElement.dataset[attr];
    return data;
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

let violations = new Set();
let documentOrigin = new URL(document.URL).origin;
window.addEventListener("securitypolicyviolation", e => {
  if (!e.isTrusted) return;
  let {violatedDirective, originalPolicy} = e;

  let type = violatedDirective.split("-", 1)[0]; // e.g. script-src 'none' => script
  let url = e.blockedURI;
  if (type === "media" && /^data\b/.test(url) && (!CSP.isMediaBlocker(originalPolicy) ||
      ns.embeddingDocument || !document.querySelector("video,audio")))
    return;
  if (!ns.CSP || !(CSP.normalize(originalPolicy).includes(ns.CSP))) {
    // this seems to come from page's own CSP
    return;
  }
  let documentUrl = document.URL;
  let origin;
  if (!(url && url.includes(":"))) {
    url = documentUrl;
    origin = documentOrigin;
  } else {
    ({origin} = new URL(url));
  }
  let key = RequestKey.create(origin, type, documentOrigin);
  if (violations.has(key)) return;
  violations.add(key);
  if (type === "frame") type = "sub_frame";
  seen.record({
    policyType: type,
    request: {
      key,
      url,
      type,
      documentUrl,
    },
    allowed: false
  });
  Messages.send("violation", {url, type});
}, true);


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

    onScriptDisabled();
  }

  notifyPage();
});

ns.fetchPolicy();
notifyPage();

addEventListener("DOMContentLoaded", e => {
  if (ns.canScript) return;
  for (let m of document.querySelectorAll("meta[http-equiv=refresh]")) {
    if (/^[^,;]*[,;](?:\W*url[^=]*=)?[^!#$%&()*+,/:;=?@[\]\w.,~-]*data:/i.test(m.getAttribute("content"))) {
      let url = m.getAttribute("content").replace(/.*?(?=data:)/i, "");
      log(`Blocking refresh to ${url}`);
      window.stop();
    }
  }
});
