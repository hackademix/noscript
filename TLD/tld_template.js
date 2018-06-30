var tld = {
  normalize(d) { return d; },

  isIp(d) { return this._ipRx.test(d); },

  getDomain(domain) {
    if (domain === "localhost" || this.isIp(domain)) return domain;

    domain = this.normalize(domain);
    var pos = domain.search(this._tldEx);
    if(pos === -1 ) {
      pos = domain.search(this._tldRx);
      if (pos === -1) {
        // TLD not in the public suffix list, fall back to the "one-dot rule"
        pos = domain.lastIndexOf(".");
        if (pos === -1) {
          return "";
        }
      }
      pos = domain.lastIndexOf(".", pos - 1) + 1;
    } else if(domain[pos] == ".") {
      ++pos;
    }
    return pos <= 0 ? domain : domain.substring(pos);
  },

  getPublicSuffix(domain) {
    if (this.isIp(domain)) return "";

    domain = this.normalize(domain);
    var pos = domain.search(this._tldEx);
    if(pos < 0) {
      pos = domain.search(this._tldRx);
      if(pos >= 0 && domain[pos] == ".") pos++;
    } else {
      pos = domain.indexOf(".", pos + 1) + 1;
    }
    return pos < 0 ? "" : domain.substring(pos);
  },

  _ipRx: /^(?:0\.|[1-9]\d{0,2}\.){3}(?:0|[1-9]\d{0,2})$|:.*:/i,

  _tldRx: /(?:\.|^)%tld_rx%$/
  ,
  _tldEx: /(?:\.|^)%tld_ex%$/
}
