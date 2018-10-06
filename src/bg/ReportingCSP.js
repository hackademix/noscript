"use strict";

function ReportingCSP(reportURI, reportGroup) {
  const REPORT_TO_SUPPORTED = false;
  // TODO: figure out if we're running on a browser supporting the report-to
  // CSP directive, breaking report-uri, see
  // 1. https://www.w3.org/TR/CSP3/#directive-report-uri
  // 2. https://bugs.chromium.org/p/chromium/issues/detail?id=726634
  // 3. https://bugzilla.mozilla.org/show_bug.cgi?id=1391243

  const REPORT_TO = {
    name: "Report-To",
    value: JSON.stringify({ "url": reportURI,
             "group": reportGroup,
             "max-age": 10886400 }),
  };
  return Object.assign(
    new CapsCSP(new NetCSP(
      REPORT_TO_SUPPORTED ? `;report-to ${reportGroup};`
        : `report-uri ${reportURI};`
    )),
    {
      reportURI,
      reportGroup,
      patchHeaders(responseHeaders, capabilities) {
        let header = null;
        let needsReportTo = REPORT_TO_SUPPORTED;
        for (let h of responseHeaders) {
          if (this.isMine(h)) {
            header = h;
            h.value = "";
          } else if (needsReportTo &&
              h.name === REPORT_TO.name && h.value === REPORT_TO.value) {
            needsReportTo = false;
          }
        }

        let blocker = capabilities && this.buildFromCapabilities(capabilities);
        if (blocker) {
          if (needsReportTo) {
            responseHeaders.push(REPORT_TO);
          }
          if (header) {
            header.value = blocker;
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
