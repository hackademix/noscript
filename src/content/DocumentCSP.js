'use strict';

class DocumentCSP {
  constructor(document) {
    this.document = document;
    this.builder = new CapsCSP();
  }
  
  apply(capabilities) {
    let csp = this.builder;
    let blocker = csp.buildFromCapabilities(capabilities);
    if (!blocker) return;
    
    let document = this.document;
    let header = csp.asHeader(blocker);
    let meta = document.createElementNS("http://www.w3.org/1999/xhtml", "meta");
    meta.setAttribute("http-equiv", header.name);
    meta.setAttribute("content", header.value);
    let parent = document.head || document.documentElement;
    try {
      parent.insertBefore(meta, parent.firstChild);
    } catch (e) {
      error(e, "Error inserting CSP %s in the DOM", header && header.value);
    }
  }
}
