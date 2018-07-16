class ContentMetaData {
  constructor(request, defaultCharset = "utf-8") {
    this.defaultCharset = defaultCharset;
    let {responseHeaders} = request;
    for (let h of responseHeaders) {
      if (/^\s*Content-(Type|Disposition)\s*$/i.test(h.name)) {
        this[h.name.split("-")[1].trim().toLowerCase()] = h.value;
      }
    }
  }

  get charset() {
    let charset = this.defaultCharset;
    if (this.type) {
      let m = this.type.match(/;\s*charset\s*=\s*(\S+)/);
      if (m) {
        charset = m[1];
      }
    }
    Object.defineProperty(this, "charset", { value: charset, writable: false, configurable: true });
    return charset;
  }

  createDecoder() {
    try {
      return new TextDecoder(this.charset);
    } catch (e) {
      return new TextDecoder(this.defaultCharset);
    }
  }
};
