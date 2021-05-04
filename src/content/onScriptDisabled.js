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
