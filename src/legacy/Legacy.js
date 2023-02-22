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

'use strict';

var Legacy = {

  async init() {
    let migrated = (await browser.storage.local.get("legacyBackup")).legacyBackup;
    let real = await this.import(migrated);
    this.init = async () => real;
    return real;
  },

  async import(migrated) {
    if (this.migrated) this.undo = this.migrated;
    this.migrated = (migrated && migrated.prefs) ? migrated : {prefs: {}};
    await include("/legacy/defaults.js");
    return 'whitelist' in this.migrated; // "real" migration with custom policy
  },

  async persist() {
    await browser.storage.local.set({legacyBackup: this.migrated});
  },

  getPref(name, def) {
    return name in this.migrated.prefs ? this.migrated.prefs[name] : def;
  },

  getRxPref(name, parseRx = Legacy.RX.multi, flags, def) {
    let source = this.getPref(name, def);
    if (source instanceof RegExp) return source;
    try {
      return parseRx(source, flags);
    } catch (e) {
      error(e, "Parsing RegExp preference %s, falling back to %s", name, def);
      if (def) {
        if (def instanceof RegExp) {
          return def;
        }
        try {
          return parseRx(def, flags);
        } catch(e) {
          error(e);
        }
      }
    }
    return null;
  },

  async createOrMigratePolicy() {
    try {
      if (await this.init()) {
        return this.migratePolicy();
      }
    } catch (e) {
      error(e);
    }
    return new Policy(Settings.createDefaultDryPolicy());
  },

  extractLists(lists) {
    return lists.map(listString => listString.split(/\s+/))
    .map(sites => sites.filter(s => !(s.includes(":") &&
                                sites.includes(s.replace(/.*:\/*(?=\w)/g, ""))
                              )));
  },

  migratePolicy() {
    // here we normalize both NS whitelist and blacklist, getting finally rid of
    // the legacy of CAPS mandating protocols for top-level domains
    let [trusted, untrusted] = this.extractLists(
        [this.migrated.whitelist, this.getPref("untrusted", "")]);

    // securify default whitelist domain items
    if (this.getPref("httpsDefWhitelist")) {
      this.getPref("default", "").
        split(/\s+/).
        filter(s => !s.includes(":")).
        forEach(s => {
          let idx = trusted.indexOf(s);
          if (idx !== -1) {
            trusted[idx] = Sites.secureDomainKey(s);
          }
        });
    }

    let DEFAULT = new Permissions(["other"]);
    let {capabilities} = DEFAULT;
    // let's semplify object permissions now that almost everything is
    // either blacklisted or C2P by the browser
    if (!["Java", "Flash", "Silverlight", "Plugins"]
          .find(type => this.getPref(`forbid${type}`))) {
      capabilities.add("object");
    }

    let prefMap = {
      "Fonts": "font",
      "Frames": "frame",
      "IFrames": "frame",
      "Media": "media",
      "WebGL": "webgl",
    };
    for (let [legacy, current] of Object.entries(prefMap)) {
      if (!this.getPref(`forbid${legacy}`, true)) capabilities.add(current);
    }

    let TRUSTED = new Permissions(new Set(this.getPref("contentBlocker") ? capabilities : Permissions.ALL));
    TRUSTED.capabilities.add("script").add("fetch");

    let UNTRUSTED = new Permissions();
    if (this.getPref("global")) {
      if (!this.getPref("alwaysBlockUntrustedContent")) {
        UNTRUSTED.capabilities = new Set(capabilities);
      }
      DEFAULT = new Permissions(TRUSTED.capabilities);
    }

    return new Policy({
      sites: {untrusted, trusted, custom: {}},
      DEFAULT,
      TRUSTED,
      UNTRUSTED,
      enforced: true,
      // TODO: enforce these before ESR 59 gets released
      cascadePermissions: this.getPref("cascadePermissions"),
      restrictSubDocScripting: this.getPref("restrictSubDocScripting"),
      onlySecure: this.getPref("allowHttpsOnly")
    });

  },

  RX: {
    simple: function(s, flags) {
      var anchor = /\^/.test(flags);
      return new RegExp(anchor ? rxParsers.anchor(s) : s,
        anchor ? flags.replace(/\^/g, '') : flags);
    },
    anchor: function(s) {
      return /^\^|\$$/.test(s) ? s : "^" + s + "$";
    },
    multi: function(s, flags) {
      var anchor = /\^/.test(flags);
      var lines = s.split(anchor ? /\s+/ : /[\n\r]+/).filter(l => /\S/.test(l));
      return new RegExp((anchor ? lines.map(rxParsers.anchor) : lines).join('|'),
        anchor ? flags.replace(/\^/g, '') : flags);
    }
  }
}
Legacy.init();
