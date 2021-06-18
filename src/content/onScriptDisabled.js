/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
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

// depends on /nscl/content/NoscriptElements.js

"use strict";
function onScriptDisabled() {
  onScriptDisabled = () => {}; // call me just once
  debug("onScriptDisabled state", document.readyState);
  if (ns.allows("noscript")) {
    NoscriptElements.emulate(true);
  } else {
    let reportNoscriptElements = () => {
      if (document.querySelector("noscript")) {
        let request = {
          id: "noscript-noscript",
          type: "noscript",
          url: document.URL,
          documentUrl: document.URL,
          embeddingDocument: true,
        };
        seen.record({policyType: "noscript", request, allowed: false});
      }
    };
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", reportNoscriptElements, true);
    } else {
      reportNoscriptElements();
    }
  }

  let eraser = {
    tapped: null,
    delKey: false,
  };

  addEventListener("pagehide", ev => {
    if (!ev.isTrusted) return;
    eraser.tapped = null;
    eraser.delKey = false;
  }, false);

  addEventListener("keyup", ev => {
    if (!ev.isTrusted) return;
    let el = eraser.tapped;
    if (el && ev.code === "Delete" || ev.code === "Backspace") {
      eraser.tapped = null;
      eraser.delKey = true;
      let doc = el.ownerDocument;
      let w = doc.defaultView;
      if (w.getSelection().isCollapsed) {
        let root = doc.body || doc.documentElement;
        let posRx = /^(?:absolute|fixed|sticky)$/;
        do {
          if (posRx.test(w.getComputedStyle(el, '').position)) {
            (eraser.tapped = el.parentNode).removeChild(el);
            break;
          }
        } while ((el = el.parentNode) && el != root);
      }
    }
  }, true);

  addEventListener("mousedown", ev => {
    if (!ev.isTrusted) return;
    if (ev.button === 0) {
      eraser.tapped = ev.target;
      eraser.delKey = false;
    }
  }, true);

  addEventListener("mouseup", ev => {
    if (!ev.isTrusted) return;
    if (eraser.delKey) {
      eraser.delKey = false;
      ev.preventDefault();
      ev.stopPropagation();
    }
    eraser.tapped = null;
  }, true);
}
