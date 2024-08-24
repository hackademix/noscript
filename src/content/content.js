/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';
//
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
  async store(event) {
    if (document.URL !== event.url) return;
    const {data} = event;
    const attr = await sha256(data.concat(Math.random()));
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

  if (!ns.allows("lazy_load")) {
    // Force loading attributes to "eager", since CSP-based script blocking
    // does not disable lazy loading as it should to address the privacy
    // concerns mentioned in the specification.
    // See https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/42805

    const toEager = el => el.setAttribute("loading", "eager");
    const toEagerAll = parent => [... parent.querySelectorAll("[loading=lazy]")].forEach(toEager);

    toEagerAll(document);
    if (document.readyState === "loading") {

      const observer = new MutationObserver(records => {
        for (const r of records) {
          console.log(r);
          switch(r.type) {
            case "attributes":
              if (r.attributeName === "loading") {
                toEager(r.target);
              }
              break;
            case "subtree":
              toEagerAll(r.target);
              break;
          }

        }
      });

      observer.observe(document.documentElement, {subtree: true, attributeFilter: ["loading"]});
      addEventListener("DOMContentLoaded", e => {
        toEagerAll(document);
        observer.disconnect();
      });
    }
  }

  if (!ns.allows("unchecked_css")) {
    // protection against CSS PP0 (https://orenlab.sise.bgu.ac.il/p/PP0)

    // In Tor Browser / private windows, with scripts disabled,
    // preload also 1st party CSS resources in order to mitigate
    // scriptless user interaction tracking.
    // See https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/42829

    const only3rdParty = ns.canScript || !browser.extension.inIncognitoContext;

    const prefetchCallback =
      // false && // REL_ONLY
      (location.hostname === 'localhost' && location.search.includes("debug_prefetch"))
      ? (rule, url) => {
        debug("Prefetching %s from CSS", url, rule.cssText);
        url.hostname = `prefetch.${url.hostname}`;
        return false; // let default processing continue with the modified hostname
      } : null;
    prefetchCSSResources(only3rdParty, prefetchCallback);
  }

  if (!ns.canScript) {
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        (async () => {
          for (let r of await navigator.serviceWorker.getRegistrations()) {
            await r.unregister();
          }
        })();
      }
    } catch (e) {
      debug(e);
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
