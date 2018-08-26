"use strict";

class NetCSP extends CSP {
  constructor(start, end) {
    super();
    this.start = start;
    this.end = end;
  }
  
  isMine(header) {
    let {name, value} = header;
    if (name.toLowerCase() !== CSP.headerName) return false;
    let startIdx = value.indexOf(this.start);
    return startIdx > -1 && startIdx < value.lastIndexOf(this.end);
  }
  
  inject(headerValue, mine) {
    let startIdx = headerValue.indexOf(this.start);
    if (startIdx < 0) return `${headerValue};${mine}`;
    let endIdx = headerValue.lastIndexOf(this.end);
    let retValue = `${headerValue.substring(0, startIdx)}${mine}`;

    return endIdx < 0 ? retValue : `${retValue}${headerValue.substring(endIdx + this.end.length + 1)}`;
  }
  
  build(...directives) {
    return `${this.start}${super.build(...directives)}${this.end}`;
  }
  
}
