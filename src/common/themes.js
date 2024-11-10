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

{
  let contentCSS;

  const VINTAGE = "vintageTheme";
  const THEMES = ["dark", "light", "auto"];

  globalThis.Themes = {
    VINTAGE,
    update() {},
    refreshVintage() {},
    async setup(theme = null) {
      if (theme) {
        if (browser && browser.storage) {
          browser.storage.local.set({theme});
        }
      } else {
        if (self.localStorage) {
          theme = localStorage.getItem("theme");
          if (!THEMES.includes(theme)) theme = null;
        }
        if (!theme && browser && browser.storage) {
          if (self.document?.readyState === "loading") {
            document.documentElement.style.visibility = "hidden";
          }
          return browser.storage.local.get(["theme"]).then(({theme}) => {
              Themes.update(theme);
              if (self.document) {
                document.documentElement.style.visibility = "";
              }
              return theme || "auto";
          });
        }
      }
      return Themes.update(theme);
    },

    async isVintage() {
      let ret;
      if (self.localStorage) {
        ret = localStorage.getItem(VINTAGE);
        if (ret !== null) return !(ret === "false" || !ret);
      }
      ret = (await browser.storage.local.get([VINTAGE]))[VINTAGE];
      return ret;
    },

    async setVintage(b) {
      Themes.refreshVintage(b);
      await browser.storage.local.set({[VINTAGE]: b});
      return b;
    },

    async getContentCSS() {
      contentCSS ||= (async () => {
        const replaceAsync = async (string, regexp, replacerFunction) => {
          regexp.lastIndex = 0;
          const promises = [];
          for (let match; match = regexp.exec(string);) {
            promises.push(replacerFunction(...match));
          }
          const replacements = await Promise.all(promises);
          regexp.lastIndex = 0;
          let i = 0;
          return string.replace(regexp, () => replacements[i++]);
        }
        const fetchAsDataURL = async (url) => {
          const blob = await (await fetch(browser.runtime.getURL(url))).blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
              resolve(reader.result);
            };
            reader.onerror = e => {
              reject(reader.error);
            };
            reader.readAsDataURL(blob);
          });
        }
        const fetchAsText = async (url) => await (await fetch(browser.runtime.getURL(url))).text();

        const themesCSS = (await replaceAsync(await fetchAsText("/common/themes.css"),
            /(--img-logo:.*url\("?)(.*\.svg)"?/g,
            async (s, prop, url) => `${prop}"${await fetchAsDataURL(url)}"`
          ))
          .replace(/.*\burl\(\.*\/.*\n/g, '')
          .replace(/\/\*[^]*?\*\//g, '')
          .replace(/\n+/g, "\n");
        return (await fetchAsText("/content/content.css"))
          .replace(/\b(THEMES_START\b.*\n)[^]*(\n.*\bTHEMES_END)\b/g,
                  `$1${themesCSS}$2`);
      })();
      return await contentCSS;
    }
  };

  (async () => {
    if (self.document) {
      await include("/common/themesDOM.js");
    }
    await Themes.setup();
    Themes.refreshVintage(await Themes.isVintage());
  })();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const ifChanged = (key, callback) => {
      if (key in changes) {
        let {oldValue, newValue} = changes[key];
        if (oldValue !== newValue) {
          callback(newValue);
          self.dispatchEvent(new CustomEvent("NoScriptThemeChanged", {detail: {[key]: newValue}}));
        }
      }
    }
    ifChanged("theme", Themes.update);
    ifChanged(VINTAGE, Themes.refreshVintage);
  });
}