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
const MANIFEST_VER = /^m?v?[2-3]/i.test(args[0]) ? args.shift() : "mv3edge";
const MANIFEST_SRC = args[0] || "src/manifest.json";
const MANIFEST_DEST = args[1] || args[0] || "build/manifest.json";


console.log(`${MANIFEST_SRC} --[${MANIFEST_VER}]--> ${MANIFEST_DEST}`);

const srcContent = fs.readFileSync(MANIFEST_SRC, 'utf8');
const json = JSON.parse(srcContent);
const permissions = new Set(json.permissions);

let extVer = json.version;
const FIREFOX_UPDATE_URL = "https://secure.informaction.com/update/?v=" + extVer;
const EDGE_UPDATE_URL = "https://edge.microsoft.com/extensionwebstorebase/v1/crx";

const isFirefox = MANIFEST_VER.includes("firefox");

if (isFirefox && /rc|\.9\d{2}$/.test(extVer)) {
  json.browser_specific_settings.update_url = FIREFOX_UPDATE_URL;
}

if (MANIFEST_VER.includes(3)) {
  // MV3
  json.manifest_version = 3;
  if (!isFirefox) {
    // convert ${ver}(a|b|rc)xx into ${ver--}.9xx
    json.version = extVer.replace(/(\d+)(?:\.0)*[a-z]+(\d+)$/,
        (all, maj, min) => `${parseInt(maj) - 1}.${900 + parseInt(min)}`);
    delete json.browser_specific_settings;
    delete json.content_security_policy;
    const {scripts} = json.background;
    delete json.background.scripts;
    delete json.background.persistent;
    const requiredPath = path.join(path.dirname(MANIFEST_DEST), "REQUIRED.js");
    scripts && fs.writeFileSync(requiredPath,
      `include.REQUIRED = ${JSON.stringify(scripts, null, 2)};`)
  }

  if (MANIFEST_VER.includes("edge")) {
    json.update_url = EDGE_UPDATE_URL;
  } else if (json.update_url === EDGE_UPDATE_URL) {
    delete json.update_url;
  }

  for (const p of [
    "<all_urls>",
    "webRequestBlocking",
    "webRequestBlocking",
    "webRequestFilterResponse",
    "webRequestFilterResponse.serviceWorkerScript",
  ]) {
    permissions.delete(p);
  }

  const excludedScriptsRx = /\bcontent\/(?:embeddingDocument|dirindex)\.js$/;
  for (const cs of json.content_scripts) {
    cs.js = cs.js.filter(src => !excludedScriptsRx.test(src));
  }
  delete json.browser_action;
  delete json.commands._execute_browser_action;
} else {
  // MV2
  json.manifest_version = 2;
  delete json.background.service_worker;
  delete json.web_accessible_resources;
  delete json.host_permissions;
  delete json.action;
  for (const p of [
    "debugger",
  ]) {
    permissions.delete(p);
  }

  // Append MAIN world "*.main.js" scripts to their isolated counterparts
  // (on Gecko we will patch windows through xray)
  const isolatedWorldJS = json.content_scripts.find(
    cs => cs.world != "MAIN" && cs.js?.some(src => src.endsWith("/Worlds.js"))).js;

  json.content_scripts.find(cs => cs.world == "MAIN" && cs.js?.some(src => src.endsWith("/Worlds.main.js")))
    .js.filter(src => src.endsWith(".main.js"))
    .forEach(src => {
      const isolatedSrc = src.replace(/.*(\/[\w+.]+)\.main(?=\.js$)/, "$1");
      const idx = isolatedWorldJS.findIndex(src => src.endsWith(isolatedSrc));
      if (idx > -1) {
        isolatedWorldJS.splice(idx + 1, 0, src)
      } else {
        isolatedWorldJS.push(src);
      }
    });

  // remove all the MAIN world content script
  json.content_scripts = json.content_scripts.filter(cs => cs.world != "MAIN");
}

// remove developer-only stuff
permissions.delete("declarativeNetRequestFeedback");

json.permissions = [...permissions];

const destContent = JSON.stringify(json, null, 2);
fs.writeFileSync(MANIFEST_DEST, destContent);
console.log(`Written ${MANIFEST_DEST}`);
