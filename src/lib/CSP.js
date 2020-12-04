"use strict";

class CSP {
  static isMediaBlocker(csp) {
    return /(?:^|[\s;])media-src (?:'none'|http:)(?:;|$)/.test(csp);
  }
  static normalize(csp) {
    return csp.replace(/\s*;\s*/g, ';').replace(/\b(script-src\s+'none'.*?;)(?:script-src-\w+\s+'none';)+/, '$1');
  }

  build(...directives) {
    return directives.join(';');
  }

  buildBlocker(...types) {
      return this.build(...(types.map(t => `${t.name || `${t.type || t}-src`} ${t.value || "'none'"}`)));
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
CSP.patchDataURI = (uri, blocker) => {
  let parts = /^data:(?:[^,;]*ml|unknown-content-type)(;[^,]*)?,/i.exec(uri);
  if (!(blocker && parts)) {
    // not an interesting data: URI, return as it is
    return uri;
  }
  if (parts[1]) {
    // extra encoding info, let's bailout (better safe than sorry)
    return "data:";
  }
  // It's a HTML/XML page, let's prepend our CSP blocker to the document
  let patch = parts[0] + encodeURIComponent(
    `<meta http-equiv="${CSP.headerName}" content="${blocker}"/>`);
  return uri.startsWith(patch) ? uri : patch + uri.substring(parts[0].length);
}
