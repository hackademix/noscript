/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
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

const fs = require('fs');
const path = require('path');

const decomment = require('decomment');

const dir = process.argv[2];

if (!dir) {
  console.error('Please provide a directory path!');
  process.exit(1);
}

function processSource(s) {
  return decomment(
    s, { space: true, tolerant: true }
  );
}

function processDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const { name } = entry;
    const entryPath = path.join(dir, name);
    if (entry.isDirectory()) {
      processDir(entryPath);
    } else if (entry.isFile() && path.extname(name) == ".js") {
      try {
        console.log(`Processing  ${entryPath}...`);
        fs.writeFileSync(entryPath, processSource(
          fs.readFileSync(entryPath, 'utf8')
        ));
         console.log(`Done processing  ${entryPath}...`);
      } catch (err) {
        console.error(`Error processing ${entryPath}:`, err.message);
      }
    }
  }
}

processDir(dir);
