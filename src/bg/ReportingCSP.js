"use strict";
  
function ReportingCSP(reportURI, reportGroup) { 
  return Object.assign(
    new CapsCSP(new NetCSP(
      `report-uri ${reportURI};`,
      `;report-to ${reportGroup};`
    )), 
    {
      reportURI,
      reportGroup,
      reportToHeader: {
        name: "Report-To",
        value: JSON.stringify({ "url": reportURI,
                 "group": reportGroup,
                 "max-age": 10886400 }),
      }
    }
  );
}    
