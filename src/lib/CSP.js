"use strict";

class CSP {

  build(...directives) {
    return directives.join(';');
  }

  buildBlocker(...types) {
      return this.build(...(types.map(type => `${type.name || type}-src ${type.value || "'none'"}`)));
  }

  blocks(header, type) {
    return `;${header};`.includes(`;${type}-src 'none';`)
  }

  asHeader(value) {
    return {name: CSP.headerName, value};
  }
}

CSP.isEmbedType = type => /\b(?:application|video|audio)\b/.test(type) && type !== "application/xhtml+xml";
CSP.headerName = "content-security-policy";
