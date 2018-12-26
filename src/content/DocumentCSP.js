'use strict';

class DocumentCSP {
  constructor(document) {
    this.document = document;
    this.builder = new CapsCSP();
  }

  apply(capabilities, embedding = CSP.isEmbedType(this.document.contentType)) {
    let csp = this.builder;
    let blocker = csp.buildFromCapabilities(capabilities, embedding);
    if (!blocker) return;

    let document = this.document;
    let createHTMLElement =
      tagName => document.createElementNS("http://www.w3.org/1999/xhtml", tagName);

    let header = csp.asHeader(blocker);
    let meta = createHTMLElement("meta");
    meta.setAttribute("http-equiv", header.name);
    meta.setAttribute("content", header.value);
    let {head} = document;
    let parent = head ||
      document.documentElement.appendChild(createHTMLElement("head"));

    try {
      parent.insertBefore(meta, parent.firstChild);
      debug(`Failsafe <meta> CSP inserted in %s: "%s"`, document.URL, header.value);
      meta.remove();
      if (!head) parent.remove();
    } catch (e) {
      error(e, "Error inserting CSP %s in %s", document.URL, header && header.value);
    }
  }

}
