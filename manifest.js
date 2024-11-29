/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2024 Giorgio Maone <https://maone.net>
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

"use strict";

const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const MANIFEST_VER = /^m?v?[2-3]$/i.test(args[0]) ? args.shift() : "mv3edge";
const MANIFEST_SRC = args[0] || "src/manifest.json";
const MANIFEST_DEST = args[1] || args[0] || "build/manifest.json";

const EDGE_UPDATE_URL = "https://edge.microsoft.com/extensionwebstorebase/v1/crx";

console.log(`${MANIFEST_SRC} --[${MANIFEST_VER}]--> ${MANIFEST_DEST}`);

const srcContent = fs.readFileSync(MANIFEST_SRC, 'utf8');
const json = JSON.parse(srcContent);
const permissions = new Set(json.permissions);

if (MANIFEST_VER.includes(3)) {
  delete json.browser_specific_settings;
  const {scripts} = json.background;

  if (scripts) {
    delete json.background.scripts;
    delete json.background.persistent;
    const requiredPath = path.join(path.dirname(MANIFEST_DEST), "REQUIRED.js");
    fs.writeFileSync(requiredPath,
      `include.REQUIRED = ${JSON.stringify(scripts, null, 2)};`)
  }

  if (MANIFEST_VER.includes("edge")) {
    json.update_url = EDGE_UPDATE_URL;
  } else if (json.update_url === EDGE_UPDATE_URL) {
    delete json.update_url;
  }

  permissions.delete("<all_urls>");
  permissions.delete("webRequestBlocking");

  const excludedScriptsRx = /\bcontent\/(?:embeddingDocument|dirindex)\.js$/;
  for (const cs of json.content_scripts) {
    cs.js = cs.js.filter(src => !excludedScriptsRx.test(src));
  }
  delete json.browser_action;
  delete json.commands._execute_browser_action
}

// remove developer-only stuff
permissions.delete("declarativeNetRequestFeedback");

json.permissions = [...permissions];

const destContent = JSON.stringify(json, null, 2);
fs.writeFileSync(MANIFEST_DEST, destContent);
console.log(`Written ${MANIFEST_DEST}`);
