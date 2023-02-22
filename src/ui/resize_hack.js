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

if ("windows" in browser) document.addEventListener("DOMContentLoaded", async e => {
  // Fix for Fx57 bug where bundled page loaded using
  // browser.windows.create won't show contents unless resized.
  // See https://bugzilla.mozilla.org/show_bug.cgi?id=1402110
  let win = await browser.windows.getCurrent({populate: true});
  if (win.tabs[0].url === document.URL) {
    debug("Resize hack");
    await browser.windows.update(win.id, {
      width: win.width + 1
    });
    await browser.windows.update(win.id, {
      width: win.width
    });
  }
});
