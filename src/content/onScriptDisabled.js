function onScriptDisabled() {
  if (document.readyState === "loading") {
    if (!onScriptDisabled._installed) {
      window.addEventListener("DOMContentLoaded", e => onScriptDisabled());
      onScriptDisabled._installed = true;
    }
    return;
  }
  onScriptDisabled = () => {};
  let refresh = false;
  for (let noscript of document.querySelectorAll("noscript")) {

    // force show NOSCRIPT elements content
    let replacement = createHTMLElement("span");
    replacement.innerHTML = noscript.innerHTML;
    // emulate meta-refresh
    for (let meta of replacement.querySelectorAll('meta[http-equiv="refresh"]')) {
      refresh = true;
      document.head.appendChild(meta);
      console.log(`State %s, emulating`, document.readyState, meta);
    }

    if (noscript.closest("head") && document.body) {
      document.body.insertBefore(noscript, document.body.firstChild);
    }
    noscript.replaceWith(replacement);
  }
  if (refresh) {
    let html = document.documentElement.outerHTML;
    let rewrite = () => {
      let document = window.wrappedJSObject ? window.wrappedJSObject.document : window.document;
      try {
        document.open();
        document.write(html);
        document.close();
      } catch (e) {
        error(e);
      }
    };
    if (document.readyState === "complete") {
      rewrite();
    } else {
      window.addEventListener("load", e => {
        if (e.isTrusted) rewrite();
      });
    }
  }
  {
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
}
