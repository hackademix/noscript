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

function testBlob() {
  if ((location.origin === "https://noscript.net" || location.origin === "null" || location.href.startsWith("data:")) && top !== window ) {
  if (!testBlob.log) testBlob.log = "";
  testBlob.log += `${document.readyState} - ${document.URL} - Policy: ${JSON.stringify(ns.policy)}<br>`;
  if (document.body) {
      document.body.style.backgroundColor = "yellow";
      let log = document.body.appendChild(document.createElement("div"));
      log.textContent = testBlob.log;
      testBlog.log = "";
    }
  }
}
testBlob();
addEventListener("DOMContentLoaded", testBlob);

patchWorkers(() => { self.patched = true; console.log("NoScript-patched worker", self, location) }); // DEV_ONLY
