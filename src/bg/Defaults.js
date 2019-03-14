'use strict';

var Defaults = {
  async init()  {
    let defaults = {
      local: {
        debug: false,
        showCtxMenuItem: true,
        showCountBadge: true,
        showFullAddresses: false,
      },
      sync: {
        "global": false,
        "xss": true,
        "xssScanRequestBody": true,
        "xssBlockUnscannedPOST": false,
        "overrideTorBrowserPolicy": false, // note: Settings.update() on reset will flip this to true
        "clearclick": true,
      }
    };
    let defaultsClone = JSON.parse(JSON.stringify(defaults));

    for (let [k, v] of Object.entries(defaults)) {
      let store = await Storage.get(k, k);
      if (k in store) {
        Object.assign(v, store[k]);
      }
      v.storage = k;
    }

    Object.assign(ns, defaults);

    // dynamic settings
    if (!ns.local.uuid) {
      ns.local.uuid = uuid();
      await ns.save(ns.local);
    }

    return ns.defaults = defaultsClone;
  }
};
