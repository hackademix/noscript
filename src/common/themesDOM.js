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

if (self.document) {
  const PARENT_CLASS = "__NoScript_Theme__";
  const patchSheet = s => {
    const PARENT_SELECTOR = `.${PARENT_CLASS}`;
    const rules = s.cssRules;
    for (let j = 0, len = rules.length; j < len; j++) {
      const rule = rules[j];
      if (rule.styleSheet && patchSheet(rule.styleSheet)) {
        return true;
      }
      if (rule.conditionText !== "(prefers-color-scheme: light)") continue;
      for (let r of rule.cssRules) {
        let {selectorText} = r;
        if (selectorText.includes("[data-theme=") || !selectorText.startsWith(PARENT_SELECTOR)) continue;
        selectorText = selectorText.replace(PARENT_SELECTOR, `${PARENT_SELECTOR}[data-theme="light"]`);
        s.insertRule(`${selectorText} {${r.style.cssText}}`, j);
      }
      return true;
    }
    return false;
  }

  const patchAll = () => {
    for (const s of document.styleSheets) {
      try {
        if (patchSheet(s)) return true;
      } catch (e) {
        // cross-site stylesheet?
       debug(e, s.href); // DEV_ONLY
      }
    }
    return false;
  }

  if (!patchAll()) {
    debug("Couldn't patch sheets while loading, deferring to onload"); // DEV_ONLY
    const onload = e => {
      if (patchAll()) {
        removeEventListener(e.type, onload, true);
      }
    }
    addEventListener("load", onload, true);
  }

  const root = document.documentElement;
  root.classList.add(PARENT_CLASS);

  Themes.update = toTheme => {
    if (window.localStorage) try {
      localStorage.setItem("theme", toTheme);
    } catch (e) {}
    return root.dataset.theme = toTheme;
  }

  const updateFavIcon = isVintage => {
    let favIcon = document.querySelector("link[rel=icon]");
    if (!favIcon) return;
    let {href} = favIcon;
    const BASE = new URL("/img/", location.href);
    if (!href.startsWith(BASE)) return alert("return");
    const SUB = BASE + "vintage/";
    let vintageIcon = href.startsWith(SUB);
    if (isVintage === vintageIcon) return;
    favIcon.href = isVintage ? href.replace(BASE, SUB) : href.replace(SUB, BASE);
  }

  Themes.refreshVintage = isVintage => {
    if (localStorage) try {
      localStorage.setItem(Themes.VINTAGE, isVintage || "");
    } catch (e) {}
    document.documentElement.classList.toggle("vintage", isVintage === true);
    browser?.action?.setIcon({path: {64: `/img${isVintage ? "/vintage/" : "/"}ui-maybe64.webp` }});
    updateFavIcon(isVintage);
  }
}
