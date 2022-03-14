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

{
  let patchSheet = s => {
    let rules = s.cssRules;
    for (let j = 0, len = rules.length; j < len; j++) {
      let rule = rules[j];
      if (rule.styleSheet && patchSheet(rule.styleSheet)) {
        return true;
      }
      if (rule.conditionText !== "(prefers-color-scheme: light)") continue;
      for (let r of rule.cssRules) {
        s.insertRule(`${r.selectorText}[data-theme="light"] {${r.style.cssText}}`, j);
      }
      return true;
    }
    return false;
  }

  let patchAll = () => {
    for (let s of document.styleSheets) {
      if (patchSheet(s)) return true;
    }
    return false;
  }

  patchAll();
  if (!patchAll()) {
    console.error("Couldn't patch sheets while loading, deferring to onload");
    let onload = e => {
      if (patchAll()) {
        removeEventListener(e.type, onload, true);
      }
    }
    addEventListener("load", onload, true);
  }
  var Themes = {
   setup(theme = null) {
      if (theme) {
        localStorage.setItem("theme", theme);
      } else {
        theme = localStorage.getItem("theme") || "auto";
      }
      let root = document.documentElement;
      root.classList.add("__NoScript_Theme__");
      return root.dataset.theme = theme;
    }
  }
  Themes.setup();
}