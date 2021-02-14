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
              error(e, "Can't run content script on tab", tab);
              break;
            }
          }
        }));
      }

      let {reason, previousVersion} = details;
      if (reason !== "update") return;

      try {
        await LifeBoat.retrieveAndDestroy();
      } catch (e) {
        error(e);
      }

      await include("/lib/Ver.js");
      previousVersion = new Ver(previousVersion);
      let currentVersion = new Ver(browser.runtime.getManifest().version);
      let upgrading = Ver.is(previousVersion, "<=", currentVersion);
      if (!upgrading) return;

      // put here any version specific upgrade adjustment in stored data

      if (Ver.is(previousVersion, "<=", "11.0.10")) {
        log(`Upgrading from 11.0.10 or below (${previousVersion}): configure the "ping" capability.`);
        await ns.initializing;
        ns.policy.TRUSTED.capabilities.add("ping");
        await ns.savePolicy();
      }
      if (Ver.is(previousVersion, "<", "11.2.rc4")) {
        log(`Upgrading from ${previousVersion}: configure the "noscript" capability.`);
        await ns.initializing;
        let {DEFAULT, TRUSTED, UNTRUSTED} = ns.policy;
        // let's add "noscript" to DEFAULY, TRUSTED and any CUSTOM preset
        let presets = [DEFAULT, TRUSTED];
        presets = presets.concat([...ns.policy.sites.values()].filter(p => p !== TRUSTED && p !== UNTRUSTED));
        for (let p of presets) {
          p.capabilities.add("noscript");
        }
        await ns.savePolicy();
      }
    },

    async onUpdateAvailable(details) {
      try {
        if (ns.local.amnesticUpdates) {
          // user doesn't want us to remember temporary settings across updates: bail out
          return;
        }
        await include("/lib/Ver.js");
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