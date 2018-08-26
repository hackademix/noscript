"use strict";

function CapsCSP(baseCSP = new CSP()) {
  return Object.assign(baseCSP, {
    types: ["script", "object", "media"],
    dataUriTypes: ["font", "media", "object"],
    buildFromCapabilities(capabilities, netBlocker = false) {
      let forbidData = new Set(this.dataUriTypes.filter(t => !capabilities.has(t)));
      let blockedTypes;
      if (netBlocker) {
        blockedTypes = new Set(this.types.filter(t => !capabilities.has(t)));
      } else if(!capabilities.has("script")) {
        blockedTypes = new Set(["script"]);
        forbidData.add("object"); // data: URIs loaded in objects may run scripts
      } else {
        blockedTypes = new Set();
      }

      for (let type of forbidData) {
        if (blockedTypes.has(type)) continue;
        // HTTP is blocked in onBeforeRequest, let's allow it only and block
        // for instance data: and blob: URIs
        let dataBlocker = {name: type, value: "http: https:"};
        blockedTypes.add(dataBlocker)
      }

      return blockedTypes.size ? this.buildBlocker(...blockedTypes) : null;
    }
  });
}
