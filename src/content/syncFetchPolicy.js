/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
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

// depends on /nscl/content/DocRewriter.js

"use strict";

if (FILE_OR_FTP) {
  (globalThis.ns ||= {}).syncFetchPolicy = function() {

    ns.pendingSyncFetchPolicy = false;
    ns.syncFetchPolicy = () => {};

    let url = document.URL;

    // Here we've got no CSP header yet (file: or ftp: URL), we need one
    // injected in the DOM as soon as possible.
    debug("No CSP yet for non-HTTP document load: fetching policy synchronously...", ns);

    let syncSetup = ns.setup.bind(ns);

    if (window.wrappedJSObject) {
      if (top === window) {
        let persistentPolicy = null;
        syncSetup = policy => {
          if (persistentPolicy) return;
          ns.setup(policy);
          persistentPolicy = JSON.stringify(policy);
          Object.freeze(persistentPolicy);
          try {
            Object.defineProperty(window.wrappedJSObject, "_noScriptPolicy", {value: cloneInto(persistentPolicy, window)});
          } catch(e) {
            error(e);
          }
        };
      } else try {
        if (top.wrappedJSObject._noScriptPolicy) {
          debug("Policy set in parent frame found!")
          try {
            ns.setup(JSON.parse(top.wrappedJSObject._noScriptPolicy));
            return;
          } catch(e) {
            error(e);
          }
        }
      } catch (e) {
        // cross-origin access violation, ignore
      }
    }
    if (ns.domPolicy) {
      syncSetup(ns.domPolicy);
      return;
    }

    debug("Initial document state",  document.readyState, document.documentElement, document.head, document.body); // DEV_ONLY

    let mustFreeze = document.head && UA.isMozilla
      && (!/^(?:image|video|audio)/.test(document.contentType) || document instanceof XMLDocument)
      && document.readyState !== "complete";

    if (mustFreeze) {
      // Mozilla has already parsed the <head> element, we must take extra steps...
      try {
        DocumentFreezer.freeze();

        ns.on("capabilities", () => {

          let {readyState} = document;

          debug("Readystate: %s, suppressedScripts = %s, canScript = %s", readyState, DocumentFreezer.suppressedScripts, ns.canScript);

          if (!ns.canScript) {
            queueMicrotask(() => DocumentFreezer.unfreeze());
            let normalizeDir = e => {
              // Chromium does this automatically. We need it to understand we're a directory earlier and allow browser UI scripts.
              if (document.baseURI === document.URL + "/") {
                if (e) {
                  document.removeEventListener(e.type, normalizeDir);
                  e.stopImmediatePropagation();
                }
                window.stop();
                location.replace(document.baseURI);
              }
            }
            if (DocumentFreezer.firedDOMContentLoaded) {
              normalizeDir();
            } else {
              document.addEventListener("readystatechange", normalizeDir);
            }
            return;
          }

          if (DocumentFreezer.suppressedScripts === 0 && readyState === "loading") {
            // we don't care reloading, if no script has been suppressed
            // and no readyState change has been fired yet
            DocumentFreezer.unfreeze();
            return;
          }

          let softReload = ev => {
            removeEventListener("DOMContentLoaded", softReload, true);
            try {
              debug("Soft reload", ev); // DEV_ONLY
              try {
                let isDir = document.querySelector("link[rel=stylesheet][href^='chrome:']")
                    && document.querySelector(`base[href^="${url}"]`);
                if (isDir || document.contentType !== "text/html") {
                  throw new Error(`Can't document.write() on ${isDir ? "directory listings" : document.contentType}`)
                }

                DocumentFreezer.unfreeze();

                let html = document.documentElement.outerHTML;
                let sx = window.scrollX, sy = window.scrollY;
                DocRewriter.rewrite(html);
                debug("Written", html);
                // Work-around this rendering bug: https://forums.informaction.com/viewtopic.php?p=103105#p103050
                debug("Scrolling back to", sx, sy);
                window.scrollTo(sx, sy);
              } catch (e) {
                debug("Can't use document.write(), XML document?", e);
                try {
                  let eventSuppressor = ev => {
                    if (ev.isTrusted) {
                      debug("Suppressing natural event", ev);
                      ev.preventDefault();
                      ev.stopImmediatePropagation();
                      ev.currentTarget.removeEventListener(ev.type, eventSuppressor, true);
                    }
                  };
                  let svg = document.documentElement instanceof SVGElement;
                  if (svg) {
                    document.addEventListener("SVGLoad", eventSuppressor, true);
                  }
                  document.addEventListener("DOMContentLoaded", eventSuppressor, true);
                  if (ev) eventSuppressor(ev);
                  DocumentFreezer.unfreeze();
                  let scripts = [], deferred = [];
                  // push deferred scripts, if any, to the end
                  for (let s of document.getElementsByTagName("script")) {
                    (s.defer && !s.text ? deferred : scripts).push(s);
                    s.addEventListener("beforescriptexecute", e => {
                      console.debug("Suppressing", script);
                      e.preventDefault();
                    });
                  }
                  if (deferred.length) scripts.push(...deferred);
                  let doneEvents = ["afterscriptexecute", "load", "error"];
                  (async () => {
                    for (let s of scripts) {
                      let clone = document.createElementNS(s.namespaceURI, "script");
                      for (let a of s.attributes) {
                        clone.setAttributeNS(a.namespaceURI, a.name, a.value);
                      }
                      clone.innerHTML = s.innerHTML;
                      await new Promise(resolve => {
                        let listener = ev => {
                          if (ev.target !== clone) return;
                          debug("Resolving on ", ev.type, ev.target);
                          resolve(ev.target);
                          for (let et of doneEvents) removeEventListener(et, listener, true);
                        };
                        for (let et of doneEvents) {
                          addEventListener(et, listener, true);
                        }
                        s.replaceWith(clone);
                        debug("Replaced", clone);
                      });
                    }
                    debug("All scripts done, firing completion events.");
                    document.dispatchEvent(new Event("readystatechange"));
                    if (svg) {
                      document.documentElement.dispatchEvent(new Event("SVGLoad"));
                    }
                    document.dispatchEvent(new Event("DOMContentLoaded", {
                      bubbles: true,
                      cancelable: false
                    }));
                    if (document.readyState === "complete") {
                      window.dispatchEvent(new Event("load"));
                    }
                  })();
                } catch (e) {
                  error(e);
                }
              }
            } catch(e) {
              error(e);
            }
          };

          if (DocumentFreezer.firedDOMContentLoaded || document.readyState !== "loading") {
            softReload();
          } else {
            debug("Deferring softReload to DOMContentLoaded...");
            addEventListener("DOMContentLoaded", softReload, true);
          }

        });
      } catch (e) {
        error(e);
      }
    }

    ns.fetchLikeNoTomorrow(url, syncSetup);
  };

  if (ns.pendingSyncFetchPolicy) {
    ns.syncFetchPolicy();
  }
}