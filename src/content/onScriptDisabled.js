function onScriptDisabled() {
  for (let noscript of document.querySelectorAll("noscript")) {
    // force show NOSCRIPT elements content
    let replacement = createHTMLElement("span");
    replacement.innerHTML = noscript.innerHTML;
    noscript.parentNode.replaceChild(replacement, noscript);
    // emulate meta-refresh
    let meta = replacement.querySelector('meta[http-equiv="refresh"]');
    if (meta) {
      let content = meta.getAttribute("content");
      if (content) {
        let [secs, url] = content.split(/\s*;\s*url\s*=\s*/i);
        let urlObj;
        if (url) {
          try {
            urlObj = new URL(url.replace(/^(['"]?)(.+?)\1$/, '$2'));
            if (!/^https?:/.test(urlObj.protocol)) {
              continue;
            }
          } catch (e) {
            continue;
          }
          window.setTimeout(() => location.href = urlObj, (parseInt(secs) || 0) * 1000);
        }
      }
    }
  }

  {
    let eraser = {
      tapped: null,
      delKey: false,
    };

    addEventListener("pagehide", ev => {
      eraser.tapped = null;
      eraser.delKey = false;
    }, false);

    addEventListener("keyup", ev => {
      let el = eraser.tapped;
      if (el && ev.keyCode === 46) {
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
      if (ev.button === 0) {
        eraser.tapped = ev.target;
        eraser.delKey = false;
      }
    }, true);

    addEventListener("mouseup", ev => {
      if (eraser.delKey) {
        eraser.delKey = false;
        ev.preventDefault();
        ev.stopPropagation();
      }
      eraser.tapped = null;
    }, true);
  }
}
