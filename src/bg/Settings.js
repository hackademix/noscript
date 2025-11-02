/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
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

    // figure out whether it's just a trusted/untrusted list, a serialized policy or a full settings export
    try {
      let json = JSON.parse(data);
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

  async importLists(data) {
    const extractLists = lists =>
      lists.map(listString => listString.split(/\s+/))
        .map(sites => sites.filter(s => !(
          s.includes(":") &&
          sites.includes(s.replace(/.*:\/*(?=\w)/g, ""))
        )));

    try {
      let [trusted, untrusted] = extractLists(data.split("[UNTRUSTED]"));
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
      settingsHost,
    } = settings;
    debug("Received settings ", settings);
    let oldDebug = ns.local.debug;

    let reloadOptionsUI = false;

    if (isTorBrowser) {
      // Initialization or Security Level change message from Tor / Mullvad Browser
      reloadOptionsUI = true;

      if (policy?.TRUSTED) {
        // Gracefully handle "new" capabilities still unknown to our settings host
        const knownCapabilities = settingsHost?.knownCapabilities
          || policy.TRUSTED.capabilities;

        for (const cap of ["lazy_load", "unchecked_css", "wasm"]) {
          // Scripting far exceeds the security/privacy concerns around these capabilities,
          // or they are disabled by other mean by our settingHost (e.g. wasm),
          // so enable them on script-capable presets unless our settingsHost knows better.
          if (knownCapabilities.includes(cap)) continue;
          for (const preset of ["TRUSTED", "UNTRUSTED", "DEFAULT"]) {
            if (!policy[preset]) continue;
            const {capabilities} = policy[preset];
            if (capabilities.includes("script") && !capabilities.includes(cap)) {
              capabilities.push(cap);
            }
          }
        }
      }

      const torBrowserSettings = {
        local: {
          isTorBrowser: true,
          torBrowserPolicy: policy, // save for reset
        },
        sync: {
          cascadeRestrictions: true,
        }
      }
      for (const [storage, prefs] of Object.entries(torBrowserSettings)) {
        settings[storage] = Object.assign(settings[storage] || {}, prefs);
        // instantly mirror to ns.local & ns.sync
        Object.assign(ns[storage], prefs);
      }

      if (!ns.gotTorBrowserInit) {
        // This is the startup message
        ns.gotTorBrowserInit = true;
        await ns.saveSession();
        // Preserve user-overridden policy, since this
        // is not an user-triggered Security Level change
        if (ns.sync.overrideTorBrowserPolicy) {
          policy = null;
        }
      }
    }

    if (ns.local.isTorBrowser) {
      // prevents resets from forgetting Tor Browser settings
      ns.defaults.local.isTorBrowser = true;
      ns.defaults.local.torBrowserPolicy = ns.local.torBrowserPolicy;
      ns.defaults.sync.cascadeRestrictions = true;

      Sites.onionSecure = true;
    }

    if (settings.sync === null) {
      // User is resetting options:
      // pick either current Tor Browser Security Level or default NoScript policy
      policy = ns.local.torBrowserPolicy || this.createDefaultDryPolicy();
      reloadOptionsUI = true;
    }

    await Promise.allSettled(["local", "sync"].map(
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
      await ns.toggleTabRestrictions(tabId, !unrestrictedTab);
    }

    if (xssUserChoices) await XSS.saveUserChoices(xssUserChoices);

    if (reloadAffected && tabId !== -1) {
      try {
        browser.tabs.reload(tabId);
      } catch (e) {}
    }

    if (reloadOptionsUI) await this.reloadOptionsUI();
  },

  createDefaultDryPolicy() {
    const dp = new Policy().dry();
    if (ns.local?.isTorBrowser) {
      return dp; // no default trusted sites
    }
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
      exportMeta: {
        version: browser.runtime.getManifest().version,
        knownCapabilities: Permissions.ALL,
      },
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
