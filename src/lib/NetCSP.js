"use strict";

class NetCSP extends CSP {
  constructor(start) {
    super();
    this.start = start;
  }

  isMine(header) {
    let {name, value} = header;
    return name.toLowerCase() === CSP.headerName && value.startsWith(this.start);
  }

  build(...directives) {
    return `${this.start}${super.build(...directives)}`;
  }

  cleanup(headers) {
  }
}
