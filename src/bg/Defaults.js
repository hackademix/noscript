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

var Defaults = {
  async init()  {
    let defaults = {
      local: {
        debug: false,
        showCtxMenuItem: true,
        showCountBadge: true,
        showFullAddresses: false,
        amnesticUpdates: false,
      },
      sync: {
        global: false,
        xss: true,
        TabGuardMode: "incognito",
        cascadeRestrictions : false,
        overrideTorBrowserPolicy: false, // note: Settings.update() on reset will flip this to true
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
