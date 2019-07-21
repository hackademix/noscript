'use strict';

window.addEventListener("paste", e => {
  let data = e.clipboardData;
  let html =  data.getData("text/html");
  let t = e.target;
  if (t.nodeType !== 1) t = t.parentElement;

  try {
    let node = t.cloneNode();

    node.innerHTML = html;

    if (sanitizeExtras(node)) {
      let sanitized = node.innerHTML;
      setTimeout(function() { try {
        if (sanitizeExtras(t)) {
          console.log(`[NoScript] Sanitized\n<PASTE>\n${html}\n</PASTE>to\n<PASTE>\n${t.innerHTML}\n</PASTE>`, t);
        }
      } catch(ex) {
       console.log(ex);
     }}, 0);
    }
  } catch(ex) {
    console.log(ex);
  }

  function removeAttribute(node, name, value = node.getAttribute(name)) {
    node.setAttribute(`data-noscript-removed-${name}`, value);
    node.removeAttribute(name);
  }

  function sanitizeExtras(el) {
    let ret = false;

    // remove attributes from forms
    for (let f of el.getElementsByTagName("form")) {
      for (let a of f.attributes) {
        f.removeAttribute(a.name);
        ret = true;
      }
    }

    let urlAttributes = ['href', 'to', 'from', 'by', 'values'];
    let selector = urlAttributes.map(a => `[${a}]`).join(',');
    for (let node of el.querySelectorAll(selector)) {
      for (let name of urlAttributes) {
        let value = node.getAttribute(name);
        if (/^\W*(?:(?:javascript|data):|https?:[\s\S]+[[(<])/i.test(unescape(value))) {
          node.setAttribute(`data-noscript-removed-${name}`, value);
          node.removeAttribute(name);
          ret = true;
        }
      }
    }
    return ret;
  }
}, true);
