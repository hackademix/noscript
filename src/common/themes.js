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

  if (!patchAll()) {
    console.error("Couldn't patch sheets while loading, deferring to onload");
    let onload = e => {
      if (patchAll()) {
        removeEventListener(e.type, onload, true);
      }
    }
    addEventListener("load", onload, true);
  }


  let root = document.documentElement;
  root.classList.add("__NoScript_Theme__");

  const VINTAGE = "vintageTheme";
  (async () => {
    const key = "vintageTheme";


  })();

  let update = toTheme => {
    return root.dataset.theme = toTheme;
  }

  let updateFavIcon = isVintage => {
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

  let refreshVintage = isVintage => {
    document.documentElement.classList.toggle("vintage", isVintage);
    if (browser.browserAction) {
      browser.browserAction.setIcon({path: {64: `/img${isVintage ? "/vintage/" : "/"}ui-maybe64.png` }});
    }
    updateFavIcon(isVintage);
  }

  var Themes = {
   setup(theme = null) {
      if (theme) {
        if (window.localStorage) {
          localStorage.setItem("theme", theme);
        }
        if (browser && browser.storage) {
          browser.storage.local.set({theme});
        }
      } else {
        if (localStorage) {
          theme = localStorage.getItem("theme") || "auto";
        }
        if (!theme && browser && browser.storage) {
          if (document.readyState === "loading") {
            document.documentElement.style.visibility = "hidden";
          }
          return browser.storage.local.get(["theme"]).then(r => {
              update(r.theme);
              document.documentElement.style.visibility = "";
              return r.theme;
          });
        }
      }
      return update(theme);
    },

    async isVintage() {
      let ret;
      if (localStorage) {
        ret = localStorage && localStorage.getItem(VINTAGE);
        if (ret !== null) return !!ret;
      }
      ret = (await browser.storage.local.get([VINTAGE]))[VINTAGE];
      if (localStorage && typeof ret === "boolean") localStorage.setItem(VINTAGE, ret);
      return ret;
    },

    async setVintage(b) {
      refreshVintage(b);
      if (localStorage) try {
        localStorage.setItem(VINTAGE, b || "");
      } catch (e) {}
      await browser.storage.local.set({[VINTAGE]: b});
      return b;
    },

  };

  (async () => {
    refreshVintage(await Themes.isVintage());
  })();
  Promise.resolve(Themes.setup());
}