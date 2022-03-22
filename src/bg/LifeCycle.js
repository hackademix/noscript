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

"use strict";

var LifeCycle = (() => {

  const AES = "AES-GCM",
    keyUsages = ["encrypt", "decrypt"];

  function toBase64(bytes) {
    return btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''));
  }
  function fromBase64(string) {
    return Uint8Array.from((Array.from(atob(string)).map(c => c.charCodeAt(0))));
  }
  async function encrypt(clearText) {
    let key = await crypto.subtle.generateKey({
        name: AES,
        length: 256,
      },
      true,
      keyUsages,
    );
    let iv = crypto.getRandomValues(new Uint8Array(12));
    let encoded = new TextEncoder().encode(clearText);
    let cypherText = await crypto.subtle.encrypt({
      name: AES,
      iv
    }, key, encoded);
    return {cypherText, key: await crypto.subtle.exportKey("jwk", key), iv};
  }

  var LifeBoat = {
    url: "about:blank",
    async createAndStore() {
      let allSeen = {};
      let tab;
      await Promise.all((await browser.tabs.query({})).map(
        async t => {
          let seen = await ns.collectSeen(t.id);
          if (seen) {
            allSeen[t.id] = seen;
            if (!tab || !tab.incognito && t.incognito) {
              tab = t;
            }
          }
        }
      ));


      if (!tab) { // no suitable existing tab, let's open a new one
        if (!UA.isMozilla) {
          // injecting new about:blank tabs is supported only by Mozilla: let's bailout
          return;
        }
        let {url} = LifeBoat;
        let tabInfo = {
          url,
          active: false,
        };
        if (browser.windows) { // it may be missing on mobile
          // check if an incognito window exists and open our "survival" tab there
          for (let w of await browser.windows.getAll()) {
            if (w.incognito) {
              tabInfo.windowId = w.id;
              break;
            }
          }
        }
        for (;!tab;) {
          try {
            tab = await browser.tabs.create(tabInfo);
          } catch (e) {
            error(e);
            if (tabInfo.windowId) {
            // we might not have incognito permissions, let's try using any window
              delete tabInfo.windowId;
            } else {
              return; // bailout
            }
          }
        }
      }

      let tabId = tab.id;
      let {url} = tab;
      let {cypherText, key, iv} = await encrypt(JSON.stringify({
        policy: ns.policy.dry(true),
        allSeen,
        unrestrictedTabs: [...ns.unrestrictedTabs]
      }));

      let attr;
      try {
        await new Promise((resolve, reject) => {
          let l = async (tabId, changeInfo) => {
            if (!!attr || tabId !== tab.id) return;
            debug("Survival tab updating", changeInfo);
            if (changeInfo.status !== "complete") return;
            try {
              attr = await Messages.send("store", {url, data: toBase64(new Uint8Array(cypherText))}, {tabId, frameId: 0});
              resolve();
              debug("Survival tab updated");
            } catch (e) {
              if (!Messages.isMissingEndpoint(e)) {
                error(e, "Survival tab failed");
                reject(e);
              } // otherwise we keep waiting for further updates from the tab until content script is ready to answer
              return false;
            };
            return true;
          };


          l(tabId, tab).then(r => {
            if (!r) browser.tabs.onUpdated.addListener(l);
          });
        });

        await Storage.set("local", { "updateInfo": {key, iv: toBase64(iv), tabId, url, attr}});
        tabId = -1;
        debug("Ready to reload...", await Storage.get("local", "updateInfo"));
      } finally {
        if (tabId !== -1 && url === LifeBoat.url && !ns.local.debug) {
          browser.tabs.remove(tabId); // cleanup on failure unless we want to debug a post-mortem
        }
      }
    },

    async retrieveAndDestroy() {
      let {updateInfo} = await Storage.get("local", "updateInfo");
      if (!updateInfo) return;
      await Storage.remove("local", "updateInfo");
      let {key, iv, tabId, attr, url} = updateInfo;

      let destroyIfNeeded = url === LifeBoat.url ? (keepIfDebug = false) => {
        if (tabId === -1 || url !== LifeBoat.url) return;
        if (keepIfDebug && ns.local.debug) {
          debug("Failed survival tab %s left open for debugging.", tabId);
        } else {
          browser.tabs.remove(tabId);
        }
        tabId = -1;
      } : () => {};

      try {
        key = await crypto.subtle.importKey("jwk", key, AES, true, keyUsages);
        iv = fromBase64(iv);
        let cypherText;
        for (let attempts = 3; attempts-- > 0;) {
          try {
            cypherText = await Messages.send("retrieve", {url, attr}, {tabId, frameId: 0});
            break;
          } catch (e) {
            if (Messages.isMissingEndpoint(e)) {
              debug("Cannot retrieve survival tab data, maybe content script not loaded yet. Retrying...");
              await ns.initializing;
              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              throw e;
            }
          }
        }
        if (!cypherText) {
          throw new Error("Could not retrieve survival tab data!");
        }
        cypherText = fromBase64(cypherText);
        let encoded = await crypto.subtle.decrypt({
            name: AES,
            iv
          }, key, cypherText
        );
        let {policy, allSeen, unrestrictedTabs} = JSON.parse(new TextDecoder().decode(encoded));
        if (!policy) {
          throw new error("Ephemeral policy not found in survival tab %s!", tabId);
        }
        ns.unrestrictedTabs = new Set(unrestrictedTabs);
        destroyIfNeeded();
        if (ns.initializing) await ns.initializing;
        ns.policy = new Policy(policy);
        await Promise.all(
          Object.entries(allSeen).map(
            async ([tabId, seen]) => {
              try {
                debug("Restoring seen %o to tab %s", seen, tabId);
                await Messages.send("allSeen", {seen}, {tabId, frameId: 0});
              } catch (e) {
                error(e, "Cannot send previously seen data to tab", tabId);
              }
            }
          )
        );
      } catch (e) {
        error(e);
      } finally {
        destroyIfNeeded(true);
      }
    }
  }

  return {
    async onInstalled(details) {
      browser.runtime.onInstalled.removeListener(this.onInstalled);

      if (!UA.isMozilla) {
        // Chromium does not inject content scripts at startup automatically for already loaded pages,
        // let's hack it manually.
        let contentScripts = browser.runtime.getManifest().content_scripts.find(s =>
          s.js && s.matches.includes("<all_urls>") && s.all_frames && s.match_about_blank).js;

        await Promise.all((await browser.tabs.query({})).map(async tab => {
          for (let file of contentScripts) {
            try {
              await browser.tabs.executeScript(tab.id, {file, allFrames: true, matchAboutBlank: true});
            } catch (e) {
              await include("/nscl/common/restricted.js");
              if (!isRestrictedURL(tab.url)) {
                error(e, "Can't run content script on tab", tab);
              }
              break;
            }
          }
        }));
      }

      let {reason, previousVersion} = details;
      if (reason === "update") {
        try {
          await LifeBoat.retrieveAndDestroy();
        } catch (e) {
          error(e);
        }
      }

      if (!previousVersion) return;

      await include("/nscl/common/Ver.js");
      previousVersion = new Ver(previousVersion);
      let currentVersion = new Ver(browser.runtime.getManifest().version);
      let upgrading = Ver.is(previousVersion, "<=", currentVersion);
      if (!upgrading) return;

      // put here any version specific upgrade adjustment in stored data

      let forEachPreset = async (callback, presetNames = "*") => {
        await ns.initializing;
        let changed = false;
        for (let p of ns.policy.getPresets(presetNames)) {
          if (callback(p)) changed = true;
          if (p.contextual) {
            for (let ctxP of p.contextual.values()) {
              if (callback(ctxP)) changed = true;
            }
          }
        }
        if (changed) {
          await ns.savePolicy();
        }
      };

      let configureNewCap = async (cap, presetNames, capsFilter) => {
        log(`Upgrading from ${previousVersion}: configure the "${cap}" capability.`);
        await forEachPreset(({capabilities}) => {
          if (capsFilter(capabilities) && !capabilities.has(cap)) {
            capabilities.add(cap);
            return true;
          }
        }, presetNames);
      };

      let renameCap = async (oldName, newName) => {
        log(`Upgrading from ${previousVersion}: rename capability "${oldName}" to "${newName}`);
        await forEachPreset(({capabilities}) => {
          if (capabilities.has(oldName)) {
            capabilities.delete(oldName);
            capabilities.add(newName);
            return true;
          }
        });
      };

      if (Ver.is(previousVersion, "<=", "11.0.10")) {
        await configureNewCap("ping", ["TRUSTED"]);
      }
      if (Ver.is(previousVersion, "<=", "11.2.1")) {
        await configureNewCap("noscript", ["DEFAULT", "TRUSTED", "CUSTOM"])
      }
      if (Ver.is(previousVersion, "<=", "11.2.4")) {
        // add the unchecked_css capability to any preset which already has the script capability
        await configureNewCap("unchecked_css", ["DEFAULT", "TRUSTED", "CUSTOM"], caps => caps.has("script"));
      }
      if (Ver.is(previousVersion, "<=", "11.2.5rc1")) {
        await renameCap("csspp0", "unchecked_css");
      }
      if (Ver.is(previousVersion, "<=", "11.3rc2")) {
        // add the lan capability to any preset which already has the script capability
        await configureNewCap("lan", ["DEFAULT", "TRUSTED", "CUSTOM"], caps => caps.has("script"));
      }

      if (Ver.is(previousVersion, "<=", "11.4.1rc3")) {
        // show theme switcher on update unless user has already chosen between Vintage Blue and Modern Red
        (async () => {
          let isVintage = await Themes.isVintage();
          if (typeof isVintage === "boolean") return;
          await ns.init;
          ns.openOptionsPage({tab: 2, focus: "#opt-vintageTheme", hilite: "#sect-themes"});
        })();
      }
    },

    async onUpdateAvailable(details) {
      try {
        if (ns.local.amnesticUpdates) {
          // user doesn't want us to remember temporary settings across updates: bail out
          return;
        }
        await include("/nscl/common/Ver.js");
        if (Ver.is(details.version, "<", browser.runtime.getManifest().version)) {
          // downgrade: temporary survival might not be supported, and we don't care
          return;
        }
        await LifeBoat.createAndStore();
      } catch (e) {
        console.error(e);
      } finally {
       browser.runtime.reload(); // apply update
      }
    }
  };
})();