"use strict";

class NetCSP extends CSP {
  constructor(start) {
    super();
    this.start = start;
  }

  isMine(header) {
    let {name, value} = header;
    return name.toLowerCase() === CSP.headerName &&
      value.split(/,\s*/).some(v => v.startsWith(this.start));
  }

  unmergeExtras(header) {
    let {name, value} = header;
    return value.split(/,\s*/).filter(v => !v.startsWith(this.start))
      .map(value => {name, value});
  }

  build(...directives) {
    return `${this.start};${super.build(...directives)}`;
  }

  cleanup(headers) {
  }
}
