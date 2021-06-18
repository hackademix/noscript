/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
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

browser.runtime.onConnect.addListener(port => {
  if (port.name === "noscript.popup") {
    ns.popupOpened = true;
    let pendingReload = false;
    let tabId = -1;
    port.onMessage.addListener(m => {
      if ("pendingReload" in m) {
        tabId = m.tabId;
        pendingReload = m.pendingReload;
      }
    });
    port.onDisconnect.addListener(() => {
      ns.popupOpened = false;
      if (pendingReload) {
        browser.tabs.reload(tabId);
      }
    });
  }
});
