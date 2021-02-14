// depends on /nscl/content/NoscriptElements.js

"use strict";
function onScriptDisabled() {
  onScriptDisabled = () => {};

  let emulateNoScriptElement = () => {
    if (ns.allows("noscript")) {
      NoscriptElements.emulate(true);
    }
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", emulateNoScriptElement, true);
    return;
  } else {
    emulateNoScriptElement();
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
        let posRx = /^(?:absolute|fixed)$/;
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
