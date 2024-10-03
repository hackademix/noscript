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

 {
  'use strict';
  {
    for (let event of ["onInstalled", "onUpdateAvailable"]) {
      browser.runtime[event].addListener(async details => {
        await include("/bg/LifeCycle.js");
        LifeCycle[event](details);
      });
    }
  }
  let popupURL = browser.runtime.getURL("/ui/popup.html");
  let popupFor = tabId => `${popupURL}#tab${tabId}`;

  let ctxMenuId = "noscript-ctx-menu";
  let menuShowing = false;
  const menuUpdater = async (tabId) => {
    if (!menuShowing) return;
    try {
      let badgeText = await browser.browserAction.getBadgeText({tabId});
      let title = "NoScript";
      if (badgeText) title = `${title} [${badgeText}]`;
      await browser.contextMenus.update(ctxMenuId, {title});
    } catch (e) {
      // it might break in some load stages / with privileged page: don't spam the console
    }
  }
  async function toggleCtxMenuItem(show = ns.local.showCtxMenuItem) {
    if (!("contextMenus" in browser)) return;
    let id = ctxMenuId;
    try {
      await browser.contextMenus.remove(id);
    } catch (e) {}

    if (menuShowing = show) {
      browser.contextMenus.create({
        id,
        title: "NoScript",
        contexts: ["all"]
      });
      if (!browser.tabs.onUpdated.hasListener(menuUpdater)) {
        browser.tabs.onUpdated.addListener(menuUpdater);
        browser.tabs.onActivated.addListener(({tabId}) => menuUpdater(tabId));
      }
    }
  }

  async function init() {
    await Defaults.init();

    if (!ns.policy) { // it could have been already retrieved by LifeCycle
      let policyData = (await Storage.get("sync", "policy")).policy;
      if (policyData && policyData.DEFAULT) {
        ns.policy = new Policy(policyData);
        if (ns.local.enforceOnRestart && !ns.policy.enforced) {
          ns.policy.enforced = true;
          await ns.savePolicy();
        }
      } else {
        await include("/legacy/Legacy.js");
        ns.policy = await Legacy.createOrMigratePolicy();
        await ns.savePolicy();
      }
    }

    let {isTorBrowser} = ns.local;
    Sites.onionSecure = isTorBrowser;

    if (!isTorBrowser) {
      await include("/nscl/service/prefetchCSSResources.js");
    }

    await RequestGuard.start();
    await XSS.start(); // we must start it anyway to initialize sub-objects
    if (!ns.sync.xss) {
      XSS.stop();
    }



    try {
      await Messages.send("started");
    } catch (e) {
      // no embedder to answer us
    }
    log("STARTED");
    await include("/bg/popupHandler.js");
  };

  let Commands = {
    openPageUI() {
      messageHandler.openStandalonePopup();
    },

    async toggleEnforcementForTab() {
      let [tab] = (await browser.tabs.query({
        currentWindow: true,
        active: true
      }));
      if (tab) {
        let toggle = ns.unrestrictedTabs.has(tab.id) ? "delete" : "add";
        ns.unrestrictedTabs[toggle](tab.id);
        browser.tabs.reload(tab.id);
      }
    },
    async install() {
      if ("commands" in browser) {
        // keyboard shortcuts
        browser.commands.onCommand.addListener(cmd => {
          if (cmd in Commands) {
            Commands[cmd]();
          }
        });
      }

      if ("contextMenus" in browser) {
        toggleCtxMenuItem();
        browser.contextMenus.onClicked.addListener((info, tab) => {
          if (info.menuItemId == ctxMenuId) {
            messageHandler.openStandalonePopup(tab);
          }
        });
      }

      // wiring main UI
      let ba = browser.browserAction;
      if ("setIcon" in ba) {
        //desktop or Fenix
        ba.setPopup({
          popup: popupURL
        });
      } else {
        // Fennec
        ba.onClicked.addListener(async tab => {
          try {
            await browser.tabs.remove(await browser.tabs.query({
              url: popupURL
            }));
          } catch (e) {}
          await browser.tabs.create({
            url: popupFor(tab.id)
          });
        });
      }
    }
  }

  let messageHandler = {
    async updateSettings(settings, sender) {
      if (settings.command === "tg-forget") {
        TabGuard.forget();
        delete settings.tabGuardCommand;
      }
      await Settings.update(settings);
      toggleCtxMenuItem();
    },

    async broadcastSettings({
      tabId = -1
    }) {
      let policy = ns.policy.dry(true);
      let seen = tabId !== -1 ? await ns.collectSeen(tabId) : null;
      let xssUserChoices = await XSS.getUserChoices();
      let anonymyzedTabInfo =
      await Messages.send("settings", {
        policy,
        seen,
        xssUserChoices,
        local: ns.local,
        sync: ns.sync,
        unrestrictedTab: ns.unrestrictedTabs.has(tabId),
        tabId,
        xssBlockedInTab: XSS.getBlockedInTab(tabId),
        anonymyzedTabInfo: TabGuard.isAnonymizedTab(tabId) && TabGuard.getAnonymizedTabInfo(tabId),
      });
    },

    async exportSettings() {
      return Settings.export();
    },

    async importSettings({data}) {
      return await Settings.import(data);
    },

    async fetchChildPolicy({url, contextUrl}, sender) {
      await ns.initializing;
      return ns.computeChildPolicy(...arguments);
    },

    async openStandalonePopup(tab) {
      if (!tab) tab = (await browser.tabs.query({
        currentWindow: true,
        active: true
      }))[0];

      if (!tab || tab.id === -1) {
        log("No tab found to open the UI for");
        return;
      }
      let win = await browser.windows.get(tab.windowId);
      let width = 610, height = 400;
      browser.windows.create({
        url: popupFor(tab.id),
        width,
        height,
        top: win.top + Math.round((win.height - height) / 2),
        left: win.left +  Math.round((win.width - width) / 2),
        type: "panel"
      });
    },
    async getTheme(msg, {tab, frameId}) {
      let code = await Themes.getContentCSS();
      if (!ns.local.showProbePlaceholders) {
        code += `\n.__NoScript_Offscreen_PlaceHolders__ {display: none }`;
      }
      try {
        browser.tabs.insertCSS(tab.id, {
          code,
          frameId,
          runAt: "document_start",
          matchAboutBlank: true,
          cssOrigin: "user",
        });
      } catch (e) {
        console.error(e);
      }
      return (await Themes.isVintage()) ? "vintage" : "";
    },

    async promptHook(msg, {tabId}) {
      await browser.tabs.executeScript(tabId, {
        code: "try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}",
        matchAboutBlank: true,
        allFrames: true,
      });
    },

    async reloadWithCredentials({tabId, remember}) {
      if (remember) {
        TabGuard.allow(tabId);
      }
      await TabGuard.reloadNormally(tabId);
    }
  };
  Messages.addHandler(messageHandler);

  function onSyncMessage(msg, sender) {
    switch(msg.id) {
      case "fetchChildPolicy":
        return messageHandler.fetchChildPolicy(msg, sender);
      break;
    }
  }

  var ns = {
    running: false,
    policy: null,
    local: null,
    sync: null,
    initializing: null,
    unrestrictedTabs: new Set(),
    isEnforced(tabId = -1) {
      return this.policy.enforced && (tabId === -1 || !this.unrestrictedTabs.has(tabId));
    },
    policyContext(contextualData) {
      // contextualData (e.g. a request details object) must contain a tab, a tabId or a documentUrl
      // (used as a fallback if tab's top URL cannot be retrieved, e.g. in service workers)
      let {tab, tabId, documentUrl, url} = contextualData;
      if (!tab) {
        if (contextualData.type === "main_frame") return url;
        tab = tabId !== -1 && TabCache.get(tabId);
      }
      return tab && tab.url || documentUrl || url;
    },
    requestCan(request, capability) {
      return !this.isEnforced(request.tabId) || this.policy.can(request.url, capability, this.policyContext(request));
    },

    computeChildPolicy({url, contextUrl}, sender) {
      let {tab, frameId} = sender;
      let policy = ns.policy;
      let {isTorBrowser} = ns.local;
      if (!policy) {
        console.log("Policy is null, initializing: %o, sending fallback.", ns.initializing);
        return {
          permissions: new Permissions(Permissions.DEFAULT).dry(),
          unrestricted: false,
          cascaded: false,
          fallback: true,
          isTorBrowser,
        };
      }

      let tabId = tab ? tab.id : -1;
      let topUrl;
      if (frameId === 0) {
        topUrl = url;
      } else if (tab) {
        if (!tab.url) tab = TabCache.get(tabId);
        if (tab) topUrl = tab.url;
      }
      if (!topUrl) topUrl = url;
      if (!contextUrl) contextUrl = topUrl;

      if (Sites.isInternal(url) || !ns.isEnforced(tabId)) {
        policy = null;
      }

      let permissions, unrestricted, cascaded;
      if (policy) {
        let perms = policy.get(url, contextUrl).perms;
        cascaded = topUrl && ns.sync.cascadeRestrictions;
        if (cascaded) {
          perms = policy.cascadeRestrictions(perms, topUrl);
        }
        permissions = perms.dry();
      } else {
        // otherwise either internal URL or unrestricted
        permissions = new Permissions(Permissions.ALL).dry();
        unrestricted = true;
        cascaded = false;
      }
      return {permissions, unrestricted, cascaded, isTorBrowser};
    },

    start() {
      if (this.running) return;
      this.running = true;
      browser.runtime.onSyncMessage.addListener(onSyncMessage);
      deferWebTraffic(this.initializing = init(),
        async () => {
          Commands.install();
          try {
            this.devMode = (await browser.management.getSelf()).installType === "development";
          } catch(e) {}
          if (!(this.local.debug || this.devMode)) {
            debug = () => {}; // suppress verbosity
          }
        });
    },

    stop() {
      if (!this.running) return;
      this.running = false;
      browser.runtime.onSyncMessage.removeListener(onSyncMessage);
      Messages.removeHandler(messageHandler);
      RequestGuard.stop();
      log("STOPPED");
    },

    test() {
      include("/test/run.js");
    },

    async testIC(callbackOrUrl) {
      await include("xss/InjectionChecker.js");
      let IC = await XSS.InjectionChecker;
      let ic = new IC();
      ic.logEnabled = true;
      return (typeof callbackOrUrl === "function")
        ? await callbackOrUrl(ic)
        : ic.checkUrl(callbackOrUrl);
    },

    async savePolicy() {
      if (this.policy) {
        await Storage.set("sync", {
          policy: this.policy.dry()
        });
        await browser.webRequest.handlerBehaviorChanged()
      }
      return this.policy;
    },

    openOptionsPage({tab, focus, hilite}) {
      let url = new URL(browser.runtime.getManifest().options_ui.page);
      if (tab !== undefined) {
        url.hash += `;tab-main-tabs=${tab}`;
      }
      let search = new URLSearchParams(url.search);
      if (focus) search.set("focus", focus);
      if (hilite) search.set("hilite", hilite);
      url.search = search;
      browser.tabs.create({url: url.toString() });
    },

    async save(obj) {
      if (obj && obj.storage) {
        let toBeSaved = {
          [obj.storage]: obj
        };
        await Storage.set(obj.storage, toBeSaved);
      }
      return obj;
    },

    async collectSeen(tabId) {
      await this.initializing;
      try {
        let seen = Array.from(await Messages.send("collect", {uuid: ns.local.uuid}, {tabId, frameId: 0}));
        debug("Collected seen", seen); // DEV_ONLY
        return seen;
      } catch (e) {
        await include("/nscl/common/restricted.js");
        if (!isRestrictedURL((await browser.tabs.get(tabId)).url)) {
          // probably a page where content scripts cannot run, let's open the options instead
          error(e, "Cannot collect noscript activity data");
        }
      }
      return null;
    },
  };
 }

 ns.start();
