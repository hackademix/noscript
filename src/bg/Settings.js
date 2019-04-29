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
      isTorBrowser,
    } = settings;

    let oldDebug = ns.local.debug;

    let reloadOptionsUI = false;

    if (isTorBrowser) {
      // Tor Browser-specific settings
      ns.defaults.local.isTorBrowser = true; // prevents reset from forgetting
      ns.defaults.sync.cascadeRestrictions = true; // we want this to be the default even on reset
      if (!this.gotTorBrowserInit) {
        // First initialization message from the Tor Browser
        this.gotTorBrowserInit = true;
        if (ns.sync.overrideTorBrowserPolicy) {
          // If the user chose to override Tor Browser's policy we skip
          // copying the Security Level preset on startup (only).
          // Manually changing the security level works as usual.
          ns.local.isTorBrowser = true;
          await ns.save(ns.local);
          return;
        }
      } else {
        reloadOptionsUI = true;
      }

      let torBrowserSettings = {
        local: {
          isTorBrowser: true,
        },
        sync: {
          cascadeRestrictions: true,
          xssScanRequestBody: false,
          xssBlockUnscannedPOST: true,
        }
      }
      for (let [storage, prefs] of Object.entries(torBrowserSettings)) {
        settings[storage] = Object.assign(settings[storage] || {}, prefs);
      }
    }

    if (settings.sync === null) {
      // overriden defaults when user manually resets options

      // we want the reset options to stick (otherwise it gets very confusing)
      ns.defaults.sync.overrideTorBrowserPolicy = true;
      reloadOptionsUI = true;
    }

    await Promise.all(["local", "sync"].map(
      async storage => (settings[storage] || // changed or...
          settings[storage] === null // ... needs reset to default
        ) && await ns.save(settings[storage]
            ? Object.assign(ns[storage], settings[storage]) : ns[storage] = Object.assign({}, ns.defaults[storage]))
    ));
    if (ns.local.debug !== oldDebug) {
      await include("/lib/log.js");
      if (oldDebug) debug = () => {};
    }

    if (policy) {
      ns.policy = new Policy(policy);
      await ns.savePolicy();
    }

    if (typeof unrestrictedTab === "boolean") {
      ns.unrestrictedTabs[unrestrictedTab ? "add" : "delete"](tabId);
    }
    if (reloadAffected) {
      browser.tabs.reload(tabId);
    }

    if (xssUserChoices) await XSS.saveUserChoices(xssUserChoices);

    if (ns.sync.xss) {
      XSS.start();
    } else {
      XSS.stop();
    }

    if (reloadOptionsUI) await this.reloadOptionsUI();
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
  },

  async reloadOptionsUI() {
    try {
      for (let t of await browser.tabs.query({url: browser.extension.getURL(
          browser.runtime.getManifest().options_ui.page) })
      ) {
        browser.tabs.reload(t.id);
      };
    } catch (e) {
      error(e);
    }
  }
}
