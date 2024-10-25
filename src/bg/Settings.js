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
      // Tor Browser-specific settings
      ns.defaults.local.isTorBrowser = true; // prevents reset from forgetting
      ns.defaults.sync.cascadeRestrictions = true; // we want this to be the default even on reset
      Sites.onionSecure = true;
      ns.local.torBrowserPolicy = policy; // save for reset
      if (!this.gotTorBrowserInit) {
        // First initialization message from the Tor Browser
        this.gotTorBrowserInit = true;
        if (ns.sync.overrideTorBrowserPolicy) {
          // If the user chose to override Tor Browser's policy we skip
          // copying the Security Level preset on startup (only).
          // Manually changing the security level works as usual.
          ns.local.isTorBrowser = true;
          await Promise.all([ns.saveSession(), ns.save(ns.local)]);
          this.reloadOptionsUI();
          return;
        }
      }

      reloadOptionsUI = true;

      if (policy && policy.TRUSTED) {
        // Gracefully handle "new" capabilities still unknown to our settings host
        const knownCapabilities = settingsHost && settingsHost.knownCapabilities
          || policy.TRUSTED.capabilities;

        for (const cap of ["lazy_load", "unchecked_css"]) {
          // Scripting far exceeds the security/privacy concerns around these capabilities,
          // so enable them on script-capable presets unless our settingsHost knows better.
          if (cap in knownCapabilities) continue;
          for (const preset of ["TRUSTED", "UNTRUSTED", "DEFAULT"]) {
            if (!policy[preset]) continue;
            const {capabilities} = policy[preset];
            if (capabilities.includes("script") && !capabilities.includes(cap)) {
              capabilities.push(cap);
            }
          }
        }
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
      // User is resetting options:
      // pick either current Tor Browser Security Level or default NoScript policy
      policy = ns.local.torBrowserPolicy || this.createDefaultDryPolicy();
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
      ns.toggleTabRestrictions(tabId, !unrestrictedTab);
    }
    if (reloadAffected && tabId !== -1) {
      try {
        browser.tabs.reload(tabId);
      } catch (e) {}
    }

    if (xssUserChoices) await XSS.saveUserChoices(xssUserChoices);

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
