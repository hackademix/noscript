var Settings = {

  async import(data) {

    // figure out whether it's just a whitelist, a legacy backup or a "Quantum" export
    try {
      let json = JSON.parse(data);
      if (json.whitelist) {
        return await this.importLegacy(json);
      }
      if (json.trusted) {
        return await this.importPolicy(json);
      }
      if (json.policy) {
        return await this.importSettings(json);
      }
    } catch (e) {
      return await this.importLists(data);
    }
  },

  async importLegacy(json) {
    await include("/legacy/Legacy.js");
    if (await Legacy.import(json)) {
      try {
        ns.policy = Legacy.migratePolicy();
        await ns.savePolicy();
        await Legacy.persist();
        return true;
      } catch (e) {
        error(e, "Importing legacy settings");
        Legacy.migrated = Legacy.undo;
      }
    }
    return false;
  },

  async importLists(data) {
    await include("/legacy/Legacy.js");
    try {
      let [trusted, untrusted] = Legacy.extractLists(data.split("[UNTRUSTED]"));
      let policy = ns.policy;
      for (let site of trusted) {
        policy.set(site, policy.TRUSTED);
      }
      for (let site of untrusted) {
        policy.set(site, policy.UNTRUSTED, true);
      }
      await ns.savePolicy();
    } catch (e) {
      error(e, "Importing white/black lists %s", data);
      return false;
    }
    return true;
  },

  async importPolicy(json) {
    try {
      ns.policy = new Policy(json);
      await ns.savePolicy();
      return true;
    } catch (e) {
      error(e, "Importing policy %o", json);
    }
  },

  async importSettings(json) {
    try {
      await this.update(json);
      return true;
    } catch (e) {
      error(e, "Importing settings %o", json);
    }
    return false;
  },

  async update(settings) {
    let {
      policy,
      xssUserChoices,
      tabId,
      unrestrictedTab,
      reloadAffected,
    } = settings;
    if (xssUserChoices) await XSS.saveUserChoices(xssUserChoices);
    if (policy) {
      ns.policy = new Policy(policy);
      await ns.savePolicy();
    }

    if (typeof unrestrictedTab === "boolean") {
      ns.unrestrictedTabs[unrestrictedTab ? "add" : "delete"](tabId);
      this.enforceTabRestrictions(tabId, unrestrictedTab);
    }
    if (reloadAffected) {
      browser.tabs.reload(tabId);
    }

    let oldDebug = ns.local.debug;
    await Promise.all(["local", "sync"].map(
      storage => (settings[storage] || // changed or...
          settings[storage] === null // ... needs reset to default
        ) && ns.save(
            ns[storage] = settings[storage] || ns.defaults[storage])
    ));
    if (ns.local.debug !== oldDebug) {
      await include("/lib/log.js");
      if (oldDebug) debug = () => {};
    }
    if (ns.sync.xss) {
      XSS.start();
    } else {
      XSS.stop();
    }
  },

  export() {
    return JSON.stringify({
      policy: ns.policy.dry(),
      local: ns.local,
      sync: ns.sync,
      xssUserChoices: XSS.getUserChoices(),
    }, null, 2);
  },

  async enforceTabRestrictions(tabId, unrestricted = ns.unrestrictedTabs.has(tabId)) {
    await ChildPolicies.storeTabInfo(tabId, unrestricted && {unrestricted: true});
    return unrestricted;
  }
}
