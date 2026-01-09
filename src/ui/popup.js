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

'use strict';

var sitesUI;
var port;
addEventListener("unload", e => {
  if (!UI.initialized) {
    Messages.send("openStandalonePopup");
  }
});

(async () => {

  function messageBox(className, message, extraUI = null) {
    let el = document.getElementById("message");
    if (className === "hidden" && el._lastMessage !== message) return;
    el._lastMessage = el.textContent = message;
    el.className = className;
    if (extraUI) {
      el.appendChild(extraUI);
      if (typeof extraUI.focus === "function") {
        extraUI.focus();
      }
    }
    el.scrollIntoView();
  }

  try {
    let tabId;
    UI.isBrowserAction = true;
    let optionsClosed = false;

    let tabFlags = {active: true};
    if (browser.windows) {
      // Desktop browsers only

      // The currentWindow filter seems broken on Vivaldi, sometimes returns no tab...
      // tabFlags.currentWindow = true;
      // ... so we take the long route to be safe
      tabFlags.windowId = (await browser.windows.getLastFocused())?.id;
    }
    let tab = (await browser.tabs.query(tabFlags))[0] ||
    // work-around for Firefox "forgetting" tabs on Android
      (await browser.tabs.query({url: ["*://*/*", "file:///*", "ftp://*/*"]}))[0];

    let pageTab = tab;

    if (!tab || tab.id === -1) {
      log("No tab found to open the UI for");
      close();
    }
    if (tab.url === document.URL) {
      UI.isBrowserAction = false;
      try {
        tabId = parseInt(document.URL.match(/#.*\btab(\d+)/)[1]);
        pageTab = await browser.tabs.get(tabId);
      } catch (e) {
        close();
      }
      if (browser.windows) {
        const myWinId = (await browser.windows.getCurrent()).id;
        browser.windows.onFocusChanged.addListener(windowId => {
          if (windowId !== browser.windows.WINDOW_ID_NONE && myWinId !== windowId) {
            close();
          }
        });
      }
    } else {
      tabId = tab.id;
    }

    addEventListener("keydown", e => {
      if (e.code === "Enter") {
        let focused = document.activeElement;
        if (focused.closest(".sites")) {
          close();
        }
      }
    })

    port = browser.runtime.connect({name: "noscript.popup"});
    console.debug("popupHandler port connecting"); // DEV_ONLY
    await UI.init(pageTab);

    function pendingReload(b) {
      try {
        port.postMessage({
          tabId,
          pendingReload: b && UI.local.autoReload,
        });
      } catch (e) {
        debug(e);
      }
    }


    if (UI.isBrowserAction) {
      browser.tabs.onActivated.addListener(e => {
        if (e.tabId !== tabId) close();
      });
    }

    await include("/ui/toolbar.js");
    UI.toolbarInit();
    {
      let handlers = {
        "options": e => {
          if (UA.mobile) { // Fenix fails on openOptionsPage
            browser.tabs.create({url: browser.runtime.getManifest().options_ui.page});
          } else {
            browser.runtime.openOptionsPage();
          }
          close();
        },
        "close": close,
        "reload": reload,
        "temp-trust-page": e => sitesUI.tempTrustAll(),
        "revoke-temp": e => {
          UI.revokeTemp(sitesUI?.hasTemp);
          close();
        }
      };

      for (let b of document.querySelectorAll("#top .icon")) {
        b.tabIndex = 0;
        if (b.id in handlers) {
          let h = handlers[b.id];
          b.onclick = h;
        }
      }

     let keyHandlers = {
        "r": "reload",
        "o": "options",
        "p": "temp-trust-page",
        "f": "revoke-temp",
        "G": "enforce",
        "T": "enforce-tab",
      };

      window.addEventListener("keydown", e => {
        let buttonId = keyHandlers[e.key];
        if (buttonId) document.getElementById(buttonId).click();
      }, true);

      let navigate = e => {
        let sel = e.code === "ArrowUp" ? ":last-child" : "";
        document.querySelector(`.sites tr.site${sel} input.preset:checked`).focus();
        e.preventDefault();
        e.stopPropagation();
      }

      document.querySelector("#top").addEventListener("keydown", e => {
        switch(e.code) {
          case "Space":
          case "Enter":
            e.target.click();
            e.preventDefault();
            break;
          case "ArrowDown":
          case "ArrowUp":
            navigate(e);
          break;
          case "ArrowLeft":
          case "ArrowRight":
          {
            let focused = document.activeElement;
            let all = [...focused.parentNode.querySelectorAll(".icon")];
            let index = all.indexOf(focused);
            if (index === -1) return;
            index += e.code === "ArrowRight" ? 1 : -1;
            if (index >= all.length) index = 0;
            else if (index < 0) index = all.length -1;
            all[index].focus();
            break;
          }
        }
      }, true);
    }

    let originallyEnforced = UI.policy.enforced;
    let enforcementWarning = button  => {
      if (button) {
        let clone = button.cloneNode(true);
        clone.onclick = button.onclick;
        button = clone;
      }
      messageBox(button ? "warning" : "hidden", _("NotEnforced"), button);
    };
    let setupEnforcement = () => {
      let policy = UI.policy;
      let pressed = policy.enforced;
      let button = document.getElementById("enforce");
      button.setAttribute("aria-pressed", pressed);
      button.title = _(pressed ? "NoEnforcement" :  "Enforce");
      button.onclick = async () => {
        this.disabled = true;
        policy.enforced = !pressed;
        await UI.updateSettings({policy, reloadAffected: false});
        if (policy.enforced !== originallyEnforced &&
            UI.local.autoReload &&
            (policy.enforced || UI.local.immediateUnrestrict)) {
          reload();
          close();
          return;
        }
        setupEnforcement();
        pendingReload(true);
      };
      button.disabled = false;
      enforcementWarning(!policy.enforced && button);
      setupTabEnforcement();
    };

    let setupTabEnforcement = () => {
      let pressed = !UI.unrestrictedTab;
      let button = document.getElementById("enforce-tab");
      button.setAttribute("aria-pressed", pressed);
      button.title = _(pressed ? "NoEnforcementForTab" :  "EnforceForTab");
      if (UI.policy.enforced) {
        button.onclick = async () => {
          this.disabled = true;
          await UI.updateSettings({
            unrestrictedTab: pressed,
            reloadAffected: false,
          });
          UI.unrestrictedTab = pressed;
          if (UI.local.autoReload && !(UI.unrestrictedTab && UI.local.stickyUnrestrictedTab)) {
            reload();
            close();
            return;
          }
          setupEnforcement();
          pendingReload(true);
        }
        button.disabled = false;
        enforcementWarning(UI.unrestrictedTab && button);
      } else {
        button.disabled = true;
      }
    };

    setupEnforcement();

    let mainFrame = UI.seen?.find(thing => thing.request.type === "main_frame");
    debug("Seen: %o", UI.seen);
    if (!mainFrame) {
      let isHttp = /^https?:/.test(pageTab.url);
      try {
        await include("/nscl/service/Scripting.js");
        await Scripting.executeScript({
          target: {tabId, allFrames: false},
          func: () => {}
        });
        if (isHttp) {
          document.body.classList.add("disabled");
          messageBox("warning", _("freshInstallReload"));
          let buttons = document.querySelector("#buttons");
          let b = document.createElement("button");
          b.textContent = _("OK");
          b.onclick = document.getElementById("reload").onclick = () => {
            reload();
            close();
          }
          buttons.appendChild(b).focus();
          b = document.createElement("button");
          b.textContent = _("Cancel");
          b.onclick = () => close();
          buttons.appendChild(b);
          return;
        }
      } catch (e) {
        error(e, "Could not run scripts on %s: privileged page?", pageTab.url);
      }

      await include("/nscl/common/restricted.js");
      let isRestricted = isRestrictedURL(pageTab.url);
      if (!isHttp || isRestricted) {
        messageBox("warning", _("privilegedPage"));
        let tempTrust = document.getElementById("temp-trust-page");
        mainFrame = UI.tabLess?.requests?.find(thing => thing.request.type === "main_frame");
        if (!mainFrame) {
          return;
        }
        tempTrust.disabled = true;
        UI.seen = [];
        UI.privilegedTab = true;
      }
      if (!UI.seen) {
        if (isHttp) {
          let {url} = pageTab;
          UI.seen = [
            mainFrame = {
              request: { url, documentUrl: url, type: "main_frame" }
            }
          ];
        }
      }
    }

    let justDomains = !UI.local.showFullAddresses;

    sitesUI = new UI.Sites(document.getElementById("sites"));

    sitesUI.onChange = (row) => {
      const reload = sitesUI.anyPermissionsChanged()
      pendingReload(reload);
      if (row.tabLess && UI.local.autoReload) {
        messageBox("warning", _("tabLess_reload_warning"));
      }
      if (optionsClosed) return;
      browser.tabs.query({
        url: browser.runtime.getURL(
            browser.runtime.getManifest().options_ui.page)
        }).then(tabs => {
          browser.tabs.remove(tabs.map(t => t.id));
      });
      optionsClosed = true;
    };
    initSitesUI();
    UI.onSettings.addListener(initSitesUI);

    if (UI.shouldForget) {
      // PBM or forgetful browser (Tor/Mullvad)
      UI.wireOption("overrideTorBrowserPolicy", "sync", o => {
        let {checked} = o;
        if (UI.forceIncognito !== !checked) {
          UI.forceIncognito = !checked;
          sitesUI.render();
        }
      });
    }

    async function initSitesUI() {
      pendingReload(false);
      let {
        typesMap
      } = sitesUI;
      typesMap.clear();
      let policySites = UI.policy.sites;
      let domains = new Map();
      let protocols = new Set();

      function urlToLabel(url) {
        const match = policySites.match(url);
        if (match) {
          if (match === url.protocol) {
            protocols.add(match);
          } else {
            return match;
          }
        }
        const origin = Sites.origin(url);
        const useDomain = justDomains && url.protocol != "data:";
        if (domains.has(origin)) {
          if (useDomain) {
            return domains.get(origin);
          }
        } else {
          let domain = tld.getDomain(url.hostname);
          if (domain) {
            domain = url.protocol === "https:" ? Sites.secureDomainKey(domain) : domain;
          } else {
            domain = url.protocol;
          }
          domains.set(origin, domain);
          if (useDomain) {
            return domain;
          }
        }
        return origin;
      }

      if (UI.tabLess?.requests?.length && !UI.privilegedTab) {
        if (UI.tabLess?.sidebarWidth === -1) {
          UI.tabLess = null;
        } else {
          await include("/nscl/service/SidebarUtil.js");
          const sidebarWidth = await SidebarUtil.guessSidebarWidth(tabId);
          if (sidebarWidth < UI.tabLess.sidebarWidth) {
            UI.tabLess = null;
          }
        }
      }
      const seen = UI.seen.concat(UI.tabLess?.requests || []);
      UI.tabLessSites = new Set();
      UI.tabbedSites = new Set();

      sitesUI.mainUrl = new URL(mainFrame.request.url)
      sitesUI.mainSite = urlToLabel(sitesUI.mainUrl);
      sitesUI.mainDomain = tld.getDomain(sitesUI.mainUrl.hostname);
      sitesUI.mainSiteKey = Sites.optimalKey(sitesUI.mainUrl);
      const topDataUrl = sitesUI.mainUrl.protocol == "data:" && sitesUI.mainUrl.href;

      if (topDataUrl) {
        for (const { request } of seen) {
          if (request.url == "null") {
            request.url = request.documentUrl;
          }
        }
      }

      const parsedSeen = seen.map(thing => Object.assign({
          type: thing.policyType,
          tabLess: thing.tabLess,
        }, Sites.parse(thing.request.url)))
        .filter(({ url }) => url && (
            url.origin !== "null" ||
            url.protocol === "file:" ||
            topDataUrl && url.href == topDataUrl
        ));

      const sitesSet = new Set(
        parsedSeen.map(parsed => {
          const label = parsed.type == "x-load"
            ? parsed.siteKey
            : urlToLabel(parsed.url);
          if (parsed.tabLess) {
            UI.tabLessSites.add(label);
          } else {
            UI.tabbedSites.add(label);
          }
          return parsed.label = label;
        }
      ));
      if (!justDomains || topDataUrl) {
        for (const domain of domains.values()) sitesSet.add(domain);
      }
      for (const protocol of protocols) sitesSet.add(protocol);
      const sites = [...sitesSet];
      for (const parsed of parsedSeen) {
        sites.filter(s => parsed.label === s || domains.get(Sites.origin(parsed.url)) === s).forEach(m => {
          let siteTypes = typesMap.get(m);
          if (!siteTypes) typesMap.set(m, siteTypes = new Set());
          siteTypes.add(parsed.type);
        });
      }

      sitesUI.render(sites);
      sitesUI.focus();
      window.scrollTo(0, 0);
    }

    async function reload() {
      if (sitesUI) sitesUI.clear();
      await Messages.send("reloadWithCredentials", {tabId});
      pendingReload(false);
    }

    function close() {
      if (UI.isBrowserAction) {
        window.close();
      } else {
        browser.tabs.remove(tab.id);
      }
    }

    let {
      onCompleted
    } = browser.webNavigation;

    let loadSnapshot = sitesUI.snapshot;
    let onCompletedListener = navigated => {
      if (navigated.tabId === tabId) {
        setTimeout(() => UI.pullSettings(), 500);
      }
    };
    onCompleted.addListener(onCompletedListener, {
      url: [{
        hostContains: sitesUI.mainDomain
      }]
    });
    addEventListener("blur", e => {
      onCompleted.removeListener(onCompletedListener);
      port.disconnect(); // otherwise Vivaldi keeps it after closing
    });
  } catch (e) {
    error(e, "Can't open popup");
    close();
  }

})();
