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

  var SurvivalTab = {
    url: "about:blank",
    async createAndStore() {
      let allSeen = {};
      await Promise.all((await browser.tabs.query({})).map(
        async t => {
          let seen = await ns.collectSeen(t.id);
          if (seen) allSeen[t.id] = seen;
        }
      ));

      let {url} = SurvivalTab;
      let tabInfo = {
        url,
        active: false,
      };
      if (browser.windows) { // it may be missing on mobile
        // check if an incognito windows exist and open our "survival" tab there
        for (let w of await browser.windows.getAll()) {
          if (w.incognito) {
            tabInfo.windowId = w.id;
            break;
          }
        }
      }
      let tab;
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
      let tabId = tab.id;

      let {cypherText, key, iv} = await encrypt(JSON.stringify({
        policy: ns.policy.dry(true),
        allSeen,
        unrestrictedTabs: [...ns.unrestrictedTabs]
      }));

      try {
        await new Promise((resolve, reject) => {
          let done = false;
          let l = async (tabId, changeInfo) => {
            if (done || tabId !== tab.id) return;
            debug("Survival tab updating", changeInfo);
            if (changeInfo.status !== "complete") return;
            try {
              await Messages.send("store", {url, data: toBase64(new Uint8Array(cypherText))}, {tabId, frameId: 0});
              done = true;
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

          try {
            browser.tabs.onUpdated.addListener(l);
          } catch (e) {
            reject(e);
          }
        });

        await Storage.set("local", { "updateInfo": {key, iv: toBase64(iv), tabId}});
        tabId = -1;
        debug("Ready to reload...", await Storage.get("local", "updateInfo"));
      } finally {
        if (tabId !== -1 && !ns.local.debug) {
          browser.tabs.remove(tabId); // cleanup on failure unless we want to debug a post-mortem
        }
      }
    },

    async retrieveAndDestroy() {
      let {updateInfo} = await Storage.get("local", "updateInfo");
      if (!updateInfo) return;
      await Storage.remove("local", "updateInfo");
      let {key, iv, tabId} = updateInfo;
      try {
        key = await crypto.subtle.importKey("jwk", key, AES, true, keyUsages);
        iv = fromBase64(iv);
        let cypherText;
        let {url} = SurvivalTab;
        for (let attempts = 3; attempts-- > 0;) {
          try {
            cypherText = await Messages.send("retrieve", {url}, {tabId, frameId: 0});
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
        browser.tabs.remove(tabId);
        tabId = -1;
        await ns.initializing;
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
        if (tabId !== -1) {
          if (ns.local.debug) {
            debug("Failed survival tab %s left open for debugging.", tabId);
          } else {
            browser.tabs.remove(tabId);
          }
        }
      }
    }
  }

  return {
    async onInstalled(details) {
      browser.runtime.onInstalled.removeListener(this.onInstalled);
      let {reason, previousVersion} = details;
      if (reason !== "update") return;

      try {
        await SurvivalTab.retrieveAndDestroy();
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
        ns.policy.TRUSTED.capabilities.add("ping")
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
        await SurvivalTab.createAndStore();
      } catch (e) {
        console.error(e);
      } finally {
       browser.runtime.reload(); // apply update
      }
    }
  };
})();