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

// depends on /nscl/service/Scripting.js

"use strict";
{
  {
    for (let event of ["onInstalled", "onUpdateAvailable"]) {
      browser.runtime[event].addListener(async details => {
        await include("/bg/LifeCycle.js");
        LifeCycle[event](details);
      });
    }
  }
  const popupURL = browser.runtime.getURL("/ui/popup.html");
  const popupFor = tabId => `${popupURL}#tab${tabId}`;

  const ctxMenuId = "noscript-ctx-menu";
  let menuShowing = false;
  const menuUpdater = async (tabId) => {
    if (!menuShowing) return;
    try {
      const badgeText = await browser.action.getBadgeText({tabId});
      let title = "NoScript";
      if (badgeText) title = `${title} [${badgeText}]`;
      await browser.contextMenus.update(ctxMenuId, {title});
    } catch (e) {
      // it might break in some load stages / with privileged page: don't spam the console
    }
  }
  async function toggleCtxMenuItem(show = ns.local.showCtxMenuItem) {
    if (!("contextMenus" in browser)) return;
    const id = ctxMenuId;
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

  const session = new SessionCache(
    "NoScriptSession",
    {
      afterLoad(data) {
        if (data) {
          ns.gotTorBrowserInit = data.gotTorBrowserInit;
          ns.unrestrictedTabs = new Set(data.unrestrictedTabs);
          ns.policy = new Policy(data.policy);
        }
      },
      beforeSave() { // beforeSave
        return {
          policy: ns.policy.dry(true),
          unrestrictedTabs: [...ns.unrestrictedTabs],
          gotTorBrowserInit: ns.gotTorBrowserInit,
        };
      },
    }
  );

  async function init() {
    await Defaults.init();
    await session.load();
    if (!ns.policy) { // ns.policy could have been already set by LifeCycle or SessionCache
      const policyData = (await Storage.get("sync", "policy")).policy;
      if (policyData && policyData.DEFAULT) {
        const policy = new Policy(policyData);
        if (ns.local.enforceOnRestart && !policy.enforced) {
          (ns.policy = policy).enforced = true;
          await ns.savePolicy();
        } else {
          ns.policy = policy;
        }
      } else {
        ns.policy = new Policy(Settings.createDefaultDryPolicy());
        await ns.savePolicy();
      }
    }

    const {isTorBrowser} = ns.local;
    Sites.onionSecure = isTorBrowser;

    if (!isTorBrowser) {
      await include("/nscl/service/prefetchCSSResources.js");
    }
    await Promise.allSettled([
      TabGuard.wakening,
      RequestGuard.DNRPolicy?.update(),
    ]);
    try {
      await Messages.send("started");
    } catch (e) {
      // no embedder to answer us
    }
    log("STARTED");
  };

  const Commands = {
    openPageUI() {
      messageHandler.openStandalonePopup();
    },

    async toggleEnforcementForTab() {
      const [tab] = (await browser.tabs.query({
        currentWindow: true,
        active: true
      }));
      if (tab) {
        await ns.toggleTabRestrictions(tab.id);
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
      browser.action.setPopup({popup: popupURL});
    }
  };

  const messageHandler = {
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
      const policy = ns.policy.dry(true);
      const seen = tabId !== -1 ? await ns.collectSeen(tabId) : null;
      const xssUserChoices = await XSS.getUserChoices();
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
      return await ns.computeChildPolicy(...arguments);
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
      const win = await browser.windows.get(tab.windowId);
      const width = 610, height = 400;
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
      let css = await Themes.getContentCSS();
      if (!ns.local.showProbePlaceholders) {
        css += `\n.__NoScript_Offscreen_PlaceHolders__ {display: none}`;
      }
      try {
        await Scripting.insertCSS({
          target: {tabId: tab.id, frameId},
          css,
        });
      } catch (e) {
        console.error(e);
      }
      const ret = {"vintage": !!(await Themes.isVintage())};
      console.debug("Returning from getTheme", ret); // DEV_ONLY
      return Promise.resolve(ret);
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

  let _policy = null;

  globalThis.ns = {
    running: false,
    set policy(p) {
      _policy = p;
      RequestGuard.DNRPolicy?.update();
    },
    get policy() { return _policy; },
    local: null,
    sync: null,
    initializing: null,
    unrestrictedTabs: new Set(),
    async toggleTabRestrictions(tabId, restrict = ns.unrestrictedTabs.has(tabId)) {
      ns.unrestrictedTabs[restrict ? "delete": "add"](tabId);
      await Promise.allSettled([
        session.save(),
        RequestGuard.DNRPolicy?.updateTabs(),
      ]);
    },
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

    async computeChildPolicy({url, contextUrl}, sender) {
      await ns.initializing;
      let {tab, origin} = sender;
      if (url == sender.url && url == "about:blank") {
        url = origin;
      }
      let policy = ns.policy;
      const {isTorBrowser} = ns.local;
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

      const tabId = tab ? tab.id : -1;
      let topUrl;
      const isTop = sender.frameId === 0;
      if (isTop) {
        topUrl = url;
      } else if (tab) {
        if (!tab.url) tab = TabCache.get(tabId);
        if (tab) topUrl = tab.url;
      }
      if (!topUrl) topUrl = url;
      if (!contextUrl) contextUrl = topUrl;

      let xLoadable;
      if (contextUrl.startsWith("file:")) {
        const contextDir = contextUrl.replace(/[^\/]*$/, '');
        const urls = [...policy.sites.keys()].filter(u => /^file:/.test(u));
        xLoadable = urls.filter(u =>
          policy.get(u, contextDir)?.perms?.capabilities.has("x-load"));
      }
      if (Sites.isInternal(url) || !ns.isEnforced(tabId)) {
        policy = null;
      }

      let permissions, unrestricted, cascaded;
      if (policy) {
        const policyMatch = policy.get(url, contextUrl);
        let { perms } = policyMatch;
        if (isTop) {
          const autoPerms = policy.autoAllow(url, perms);
          if (autoPerms) {
            perms = autoPerms;
            await Promise.allSettled([
              RequestGuard.DNRPolicy?.update(),
              session.save(),
            ]);
            const dnrRules = (await browser.declarativeNetRequest?.getSessionRules())?.filter(r => r?.action?.type == "allow"); // DEV_ONLY
            debug(`Auto-trusted ${Sites.optimalKey(url)}`,  dnrRules); // DEV_ONLY
          }
        } else {
          cascaded = topUrl && ns.sync.cascadeRestrictions;
          if (cascaded) {
            perms = policy.cascadeRestrictions(policyMatch, topUrl);
          }
        }
        permissions = perms.dry();
      } else {
        // otherwise either internal URL or unrestricted
        permissions = new Permissions(Permissions.ALL).dry();
        unrestricted = true;
        cascaded = false;
      }
      return {permissions, unrestricted, cascaded, isTorBrowser, xLoadable};
    },

    async init() {
      browser.runtime.onSyncMessage.addListener(onSyncMessage);
      await (Messages.wakening = this.initializing = init());
      Wakening.done();
      Commands.install();
      try {
        this.devMode = (await browser.management.getSelf()).installType === "development";
      } catch(e) {}
      if (!(this.local.debug || this.devMode)) {
        debug = () => {}; // suppress verbosity
      }
    },

    async test() {
      await include("/test/run.js"); // DEV_ONLY
      runTests();
    },

    async testIC(callbackOrUrl) {
      await include("xss/InjectionChecker.js");
      const IC = await XSS.InjectionChecker;
      const ic = new IC();
      ic.logEnabled = true;
      return (typeof callbackOrUrl === "function")
        ? await callbackOrUrl(ic)
        : ic.checkUrl(callbackOrUrl);
    },

    async savePolicy() {
      if (this.policy) {
        await Promise.allSettled([
          Storage.set("sync", {
            policy: this.policy.dry()
          }),
          session.save(),
          browser.webRequest.handlerBehaviorChanged()
        ]);
      }
      return this.policy;
    },

    openOptionsPage({tab, focus, hilite}) {
      const url = new URL(browser.runtime.getManifest().options_ui.page);
      if (tab !== undefined) {
        url.hash += `;tab-main-tabs=${tab}`;
      }
      const search = new URLSearchParams(url.search);
      if (focus) search.set("focus", focus);
      if (hilite) search.set("hilite", hilite);
      url.search = search;
      browser.tabs.create({url: url.toString() });
    },

    async save(obj) {
      if (obj && obj.storage) {
        const toBeSaved = {
          [obj.storage]: obj
        };
        await Storage.set(obj.storage, toBeSaved);
      }
      return obj;
    },

    async saveSession() {
      await session.save();
    },

    async collectSeen(tabId) {
      await this.initializing;
      try {
        const seen = Array.from(await Messages.send("collect", {uuid: ns.local.uuid}, {tabId, frameId: 0}));
        debug("Collected seen", seen); // DEV_ONLY
        return seen;
      } catch (e) {
        try {
          const {url} = (await browser.tabs.get(tabId));
          await include("/nscl/common/restricted.js");
          if (!isRestrictedURL(url)) {
            // probably a page where content scripts cannot run, let's open the options instead
            error(e, `Cannot collect noscript activity data from ${url} (tab ${tabId}!)`); // DEV_ONLY
          }
        } catch (e2) {
          error(e2, `Cannot collect seen / access url on tab ${tabId}!`) // DEV_ONLY
        }
      }
      return null;
    },
  };
 }

 ns.init();
