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

if (ns.embeddingDocument) {
  let suspended;
  let suspender = new MutationObserver(records => {
    suspended = document.body && document.body.firstElementChild;
    if (suspended) {
      debug("Suspending ", suspended);
      suspended.autoplay = false;
      if (suspended.pause) suspended.pause();
      suspended.src = suspended.currentSrc = "data:";
      if (ns.policy) replace();
    }
  });
  suspender.observe(document, {childList: true, subtree: true});

  let replace = () => {
    if (suspended) {
      debug("Restoring suspended", suspended);
      suspended.src = suspended.currentSrc = document.URL;
    }

    for (let policyType of ["object", "media"]) {
      let request = {
        id: `noscript-${policyType}-doc`,
        type: policyType,
        url: document.URL,
        documentUrl: document.URL,
        embeddingDocument: true,
      };

      if (ns.allows(policyType)) {
        suspender.disconnect();
        if (suspended) {
          suspended.autoplay = true;
          if (suspended.play) suspended.play();
        }
        let handler = PlaceHolder.handlerFor(policyType);
        if (handler && handler.selectFor(request).length > 0) {
          seen.record({policyType, request, allowed: true});
        }
      } else {
        let ph = PlaceHolder.create(policyType, request);
        if (ph.replacements.size > 0) {
          debug(`Created placeholder for ${policyType} at ${document.URL}`);
          seen.record({policyType, request, allowed: false});
        }
      }
    }
  };

  ns.on("capabilities", () => {
    if (!(document.body && document.body.firstChild)) { // we've been called early
      setTimeout(replace, 0);
      let types = {
        // Reminder: order is important because media matches also for
        // some /^application\// types
        "media": /^(?:(?:video|audio)\/|application\/(?:ogg|mp4|mpeg)$)/i,
        "object": /^application\//i,
      }
      for (let [type, rx] of Object.entries(types)) {
        if (rx.test(document.contentType)) {
          if (!ns.allows(type)) {
            window.stop();
          }
          break;
        }
      }
    } else {
      replace();
    }
  });
}
