class ResponseMetaData {
  constructor(request) {
    let {responseHeaders} = request;
    this.headers = {};
    this.contentType = this.contentDisposition = null;
    for (let h of responseHeaders) {
      if (/^\s*Content-(Type|Disposition)\s*$/i.test(h.name)) {
        let propertyName = RegExp.$1;
        propertyName = `content${propertyName.charAt(0).toUpperCase()}${propertyName.substring(1).toLowerCase()}`;
        this[propertyName] = h.value;
        this.headers[propertyName] = h;
      }
    }
    this.forcedUTF8 = false;
  }

  get charset() {
    let charset = "";
    if (this.contentType) {
      let m = this.contentType.match(/;\s*charset\s*=\s*(\S+)/);
      if (m) {
        charset = m[1];
      }
    }
    Object.defineProperty(this, "charset", { value: charset, writable: false, configurable: true });
    return charset;
  }

  get isUTF8() {
    return /^utf-?8$/i.test(this.charset);
  }

  forceUTF8() {
    if (!(this.forcedUTF8 || this.isUTF8)) {
      let h = this.headers.contentType;
      if (h) {
        h.value = h.value.replace(/;\s*charset\s*=.*|$/, "; charset=utf8");
        this.forcedUTF8 = true;
      } // if the header doesn't exist the browser should default to UTF-8 anyway
    }
    return this.forcedUTF8;
  }

  createDecoder() {
    if (this.charset) {
      try {
        return new TextDecoder(this.charset);
      } catch (e) {
        console.error(e);
      }
    }
    return new TextDecoder("utf-8");
  }
};
