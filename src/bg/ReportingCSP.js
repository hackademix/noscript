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

        let blocker = capabilities && this.buildFromCapabilities(capabilities);
        let extras = [];
        responseHeaders.forEach((h, index) => {
          if (this.isMine(h)) {
            header = h;
            if (h.value === blocker) {
              // make this equivalent but different than the original, otherwise
              // it won't be (re)set when deleted, see
              // https://dxr.mozilla.org/mozilla-central/rev/882de07e4cbe31a0617d1ae350236123dfdbe17f/toolkit/components/extensions/webrequest/WebRequest.jsm#138
              blocker += " ";
            } else {
              extras.push(...this.unmergeExtras(h));
            }
            responseHeaders.splice(index, 1);
          } else if (needsReportTo &&
              h.name === REPORT_TO.name && h.value === REPORT_TO.value) {
            needsReportTo = false;
          } else if (blocker && /^(Location|Refresh)$/i.test(h.name)) {
            // neutralize any HTTP redirection to data: URLs, like Chromium
            let  url = /^R/i.test(h.name)
              ? h.value.replace(/^[^,;]*[,;](?:\W*url[^=]*=)?[^!#$%&()*+,/:;=?@[\]\w.,~-]*/i, "") : h.value;
            if (/^data:/i.test(url)) {
              h.value = h.value.slice(0, -url.length) + "data:";
            }
          }
        });

        if (blocker) {
          if (needsReportTo) {
            responseHeaders.push(REPORT_TO);
          }
          header = this.asHeader(blocker);
          responseHeaders.push(header);
        }

        if (extras.length) {
          responseHeaders.push(...extras);
        }

        return header;
      }
    }
  );
}
