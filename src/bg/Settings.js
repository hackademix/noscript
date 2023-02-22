/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

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
      if (data.includes("[UNTRUSTED]")) await this.importLists(data);
      else throw e;
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
    debug("Received settings ", settings);
    let oldDebug = ns.local.debug;

    let reloadOptionsUI = false;

    if (isTorBrowser) {
      // Tor Browser-specific settings
      ns.defaults.local.isTorBrowser = true; // prevents reset from forgetting
      ns.defaults.sync.cascadeRestrictions = true; // we want this to be the default even on reset
      Sites.onionSecure = true;

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
        }
      }
      for (let [storage, prefs] of Object.entries(torBrowserSettings)) {
        settings[storage] = Object.assign(settings[storage] || {}, prefs);
      }
    }

    if (settings.sync === null) {
      // user is resetting options
      policy = this.createDefaultDryPolicy();

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
      await include("/nscl/common/log.js");
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

  createDefaultDryPolicy() {
    let dp = new Policy().dry();
    dp.sites.trusted = `
      addons.mozilla.org
      afx.ms ajax.aspnetcdn.com
      ajax.googleapis.com bootstrapcdn.com
      code.jquery.com firstdata.com firstdata.lv gfx.ms
      google.com googlevideo.com gstatic.com
      hotmail.com live.com live.net
      maps.googleapis.com mozilla.net
      netflix.com nflxext.com nflximg.com nflxvideo.net
      noscript.net
      outlook.com passport.com passport.net passportimages.com
      paypal.com paypalobjects.com
      securecode.com securesuite.net sfx.ms tinymce.cachefly.net
      wlxrs.com
      yahoo.com yahooapis.com
      yimg.com youtube.com ytimg.com
    `.trim().split(/\s+/).map(Sites.secureDomainKey);
    return dp;
  },

  export() {
    return JSON.stringify({
      policy: ns.policy.dry(),
      local: ns.local,
      sync: ns.sync,
      xssUserChoices: XSS.getUserChoices(),
    }, null, 2);
  },

  async reloadOptionsUI() {
    try {
      for (let t of await browser.tabs.query({url: browser.runtime.getURL(
          browser.runtime.getManifest().options_ui.page) })
      ) {
        browser.tabs.reload(t.id);
      };
    } catch (e) {
      error(e);
    }
  }
}
