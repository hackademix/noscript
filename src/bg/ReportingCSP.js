"use strict";
  
function ReportingCSP(reportURI, reportGroup) {
  const REPORT_TO = {
    name: "Report-To",
    value: JSON.stringify({ "url": reportURI,
             "group": reportGroup,
             "max-age": 10886400 }),
  };
  return Object.assign(
    new CapsCSP(new NetCSP(
      `report-uri ${reportURI};`,
      `;report-to ${reportGroup};`
    )), 
    {
      reportURI,
      reportGroup,
      patchHeaders(responseHeaders, capabilities) {
        let header = null;
        let hasReportTo = false;
        for (let h of responseHeaders) {
          if (this.isMine(h)) {
            header = h;
            h.value = this.inject(h.value, "");
          } else if (h.name === REPORT_TO.name && h.value === REPORT_TO.value) {
            hasReportTo = true;
          }
        }

        let blocker = capabilities && this.buildFromCapabilities(capabilities);
        if (blocker) {
          if (!hasReportTo) {
            responseHeaders.push(REPORT_TO);
          }
          if (header) {
            header.value = this.inject(header.value, blocker);
          } else {
            header = this.asHeader(blocker);
            responseHeaders.push(header);
          }
        }
        
        return header;
      }
    }
  );
}    
