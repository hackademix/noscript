'use strict';
class DocumentCSP {
  constructor(document) {
    this.document = document;
    this.builder = new CapsCSP();
    this.root = document.documentElement;
  }

  removeEventAttributes() {
    console.debug("Removing event attributes"); // DEV_ONLY
    let {root} = this;
    this.rootAttrs = [...root.attributes].filter(a => a.name.toLowerCase().startsWith("on"));
    for (let a of this.rootAttrs) root.removeAttributeNode(a);
  }

  apply(capabilities, embedding = CSP.isEmbedType(this.document.contentType)) {
    let {document} = this;
    if (!capabilities.has("script")) {
      // safety net for XML (especially SVG) documents and synchronous scripts running
      // while inserting the CSP <meta> element.
      document.defaultView.addEventListener("beforescriptexecute", e => {
        if (!e.isTrusted) return;
        e.preventDefault();
        debug("Fallback beforexecutescript listener blocked ", e.target);
      }, true);
    }
    if (!(document instanceof HTMLDocument)) {
      // this is not HTML, hence we cannot inject a <meta> CSP
      return false;
    }
    let csp = this.builder;
    let blocker = csp.buildFromCapabilities(capabilities, embedding);
    if (!blocker) return true;

    let createHTMLElement =
      tagName => document.createElementNS("http://www.w3.org/1999/xhtml", tagName);

    let header = csp.asHeader(blocker);
    let meta = createHTMLElement("meta");
    meta.setAttribute("http-equiv", header.name);
    meta.setAttribute("content", header.value);
    let root = document.documentElement;
    let rootAttrs = [...root.attributes].filter(a => a.name.toLowerCase().startsWith("on"));
    for (let a of rootAttrs) root.removeAttributeNode(a);

    let {head} = document;
    let parent = head ||
      (root instanceof HTMLElement
        ? document.documentElement.appendChild(createHTMLElement("head"))
        : root);

    try {
      parent.insertBefore(meta, parent.firstElementChild);
      debug(`Failsafe <meta> CSP inserted in %s: "%s"`, document.URL, header.value);
      meta.remove();
      if (!head) parent.remove();
    } catch (e) {
      error(e, "Error inserting CSP %s in %s", document.URL, header && header.value);
      return false;
    }
    return true;
  }

  restoreEventAttributes() {
    if (!this.rootAttrs) return;
    console.debug("Restoring event attributes"); // DEV_ONLY
    let {root, rootAttrs} = this;
    for (let a of rootAttrs) {
      root.setAttributeNodeNS(a);
    }
  }
}
