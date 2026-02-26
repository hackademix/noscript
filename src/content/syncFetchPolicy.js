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

if (/^(?:file|ftp):$/.test(location.protocol)) {
  // no HTTP CSP Header, possible directory listing
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

    let mustFreeze = UA.isMozilla
      && (!/^(?:image|video|audio)/.test(document.contentType) || document instanceof XMLDocument)
      && document.readyState !== "complete";

    if (mustFreeze) {
      // Mozilla has already parsed the <head> element, we must take extra steps...
      try {
        DocumentFreezer.freeze();

        ns.on("capabilities", () => {

          debug("Readystate: %s, suppressedScripts = %s, canScript = %s", document.readyState, DocumentFreezer.suppressedScripts, ns.canScript);

          if (!ns.canScript) {
            queueMicrotask(() => DocumentFreezer.unfreezeLive());
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

          DocumentFreezer.unfreezeAutoReload();
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
