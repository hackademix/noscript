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
// depends on /nscl/common/SessionCache.js
// depends on /nscl/service/TabCache.js
// depends on /nscl/service/TabTies.js

var TabGuard = (() => {

  let anonymizedTabs = new Map();
  browser.tabs.onRemoved.addListener(({id}) => {
    if (anonymizedTabs.has(id)) {
      anonymizedTabs.delete(id);
      session.save();
    }
  });

  const anonymizedRequests = new Set(); // ephemeral, lifespan is webRequest

  // Domain groups:
  // property keys are domains, property values are domain Sets
  // (session-persisted)

  let Groups = {
    allowed: {},
    filtered: {},
  };
  const forget = () => {
    Groups.allowed = {};
    Groups.filtered = {};
  };

  const groupsSerDe = (source, callback) => {
    const target = {};
    for (const [which, group] of Object.entries(source)) {
      const targetGroup = {};
      for (const [domain, otherDomains] of Object.entries(group)) {
         targetGroup[domain] = callback(otherDomains);
       }
       target[which] = targetGroup;
     }
     return target;
  };
  const session = new SessionCache(
    "TabGuard", // storageKey
    {
      afterLoad(data) { // afterLoad
        if (!data) return;
        anonymizedTabs = new Map(data.anonymizedTabs);
        Groups = groupsSerDe(data.Groups, domainsArray => new Set(domainsArray));
      },
      beforeSave() {
        return {
          anonymizedTabs: [...anonymizedTabs],
          Groups: groupsSerDe(Groups, domainsSet => [...domainsSet]),
        }
      },
    }
  );

  function mergeGroups(groups,
    {tabDomain, otherDomains}, /* anonymizedTabInfo */
    bidirectional = false) {
    const currentGroup = groups[tabDomain] || (groups[tabDomain] = new Set());
    for (let d of otherDomains) {
      currentGroup.add(d);
    }
    if (bidirectional) {
      for (let d of otherDomains)  {
        (groups[d] || (groups[d] = new Set())).add(tabDomain);
      }
    }
    session.save();
  }

  const AUTH_HEADERS_RX = /^(?:authorization|cookie)/i;

  function getDomain(u) {
    let {url, siteKey} = Sites.parse(u);
    return url?.protocol.startsWith("http") && tld.getDomain(url.hostname) || Sites.origin(siteKey);
  }

  function flattenHeaders(headers) {
    let flat = {};
    for (let h of headers) {
      flat[h.name.toLowerCase()] = h.value;
    }
    return flat;
  }

  const scheduledCuts = new Set();

  return {
    wakening: Promise.all([TabCache.wakening, TabTies.wakening, session.load()]),
    forget,
    // must be called from a webRequest.onBeforeSendHeaders blocking listener
    // TODO: explore DNR alternative
    onSend(request) {
      const mode = ns.sync.TabGuardMode;
      if (mode === "off" || !request.incognito && mode!== "global") return;

      anonymizedRequests.delete(request.id);

      const {tabId, type, url, originUrl} = request;

      if (tabId < 0) return; // no tab, no party

      if (!ns.isEnforced(tabId)) return; // leave unrestricted tabs alone

      let {requestHeaders} = request;

      let tab = TabCache.get(tabId);

      const mainFrame = type === "main_frame";
      if (mainFrame) {
        anonymizedTabs.delete(tabId);
        let headers = flattenHeaders(requestHeaders);
        let shouldCut = false;
        let safeAuth = false;
        if (headers["sec-fetch-user"] === "?1") {
          // user-activated navigation
          switch(headers["sec-fetch-site"]) {
            case "same-site":
            case "same-origin":
              // Same site manual navigation:
              // cut only if same tab (prevents automatic redirections to victim sites in new tabs)
              shouldCut = tab && originUrl === tab.url && ![...TabTies.get(tabId)]
                .filter(tid => tid !== tabId).map(TabCache.get)
                .some(t => t?.url === originUrl);
              // either way we can send authorization data
              safeAuth = true;
              break;
            case "none":
              // nav bar or bookmark
              safeAuth = shouldCut = true;
              break;
            default:
              // cut only on manual reloads
              safeAuth = shouldCut = tab?.url === request.url && tab.active;
          }
        }
        if (shouldCut) {
          debug("[TabGuard] User-typed, bookmark or user-activated same-site-same-tab navigation: scheduling tab ties cut and loading with auth.", tabId, request);
          scheduledCuts.add(request.requestId);
        } else {
          debug("[TabGuard] Automatic or cross-site navigation, keeping tab ties.", tabId, request);
          scheduledCuts.delete(request.requestId);
        }
        if (safeAuth) {
          debug("[TabGuard] User-activated same-site navigation, loading with auth.", tabId, request);
          return;
        }
      } else if (!anonymizedTabs.has(tabId)) {
        // short circuit requests in non-anonymized tabs
        return;
      }

      let targetDomain = getDomain(url);
      if (!targetDomain) return; // no domain, no cookies

      let tabDomain = getDomain(mainFrame ? url : tab?.url);
      if (!tabDomain) return; // no domain, no cookies

      let ties = TabTies.get(tabId);
      if (ties.size === 0) return; // no ties, no party

      // we suspect tabs which 1) have not been removed/discarded, 2) are restricted by policy, 3) can run JavaScript
      let suspiciousTabs = [...ties].map(TabCache.get).filter(
        tab => tab && !tab.discarded && ns.isEnforced(tab.id) &&
        (!(tab._isExplicitOrigin = tab._isExplicitOrigin || /^(?:https?|ftps?|file):/.test(tab.url)) || ns.policy.can(tab.url, "script"))
      );

      return suspiciousTabs.length > 0 && (async () => {

        let suspiciousDomains = [];
        await Promise.allSettled(suspiciousTabs.map(async (tab) => {
          if (!tab._isExplicitOrigin) { // e.g. about:blank
            // let's try retrieving actual origin
            tab._externalUrl = tab.url;
            tab._isExplicitOrigin = true;
            try {
              tab.url = (await Scripting.executeScript({
                target: {tabId: tab.id, allFrames: false},
                func: () => {
                  return window.origin === 'null' ? window.location.href : window.origin;
                },
              }))[0].result;
            } catch (e) {
              // We don't have permissions to run in this tab, probably because it has been left empty.
              debug(e);
            }
            // If it's about:blank and it has got an opener, let's assume the opener
            // is the real origin and it's using the empty tab to run scripts.
            while (tab.url === "about:blank")  {
              if (!tab.openerTabId) {
                break;
              }
              const openerTab = TabCache.get(tab.openerTabId);
              if (openerTab) {
                tab.url = openerTab.url;
              } else {
                break;
              }
            }
            if (tab.url !== "about:blank") {
              debug(`Real origin for ${tab._externalUrl} (tab ${tab.id}) is ${tab.url}.`);
              if (!ns.policy.can(tab.url, "script")) return;
            }
          }
          if (!tab._contentType) {
            try {
              tab._contentType = (await Scripting.executeScript({
                target: {tabId: tab.id},
                func() { return document.contentType }
              }))[0].result;
            } catch (e) {
              // We don't have permissions to run in this tab: privileged!
              debug(e);
              return;
            }
          }
          if (!/(?:(?:x|ht)ml|svg)\b/i.test(tab._contentType)) {
            // not a scripting-capable document - maybe a PDF?
            return;
          }
          suspiciousDomains.push(getDomain(tab.url));
        }));

        const legitDomains = Groups.allowed[tabDomain] || new Set();
        legitDomains.add(tabDomain);

        let otherDomains = new Set(suspiciousDomains.filter(d => d && !legitDomains.has(d)));
        if (otherDomains.size === 0) return; // no cross-site ties, no party

        if (!requestHeaders.some(h => AUTH_HEADERS_RX.test(h.name))) return; // no auth, no party

        // danger zone

        let filterAuth = () => {
          requestHeaders = requestHeaders.filter(h => !AUTH_HEADERS_RX.test(h.name));
          debug("[TabGuard] Removing auth headers from %o (%o)", request, requestHeaders);
          anonymizedTabs.set(tabId, {tabDomain, otherDomains: [...otherDomains]});
          session.save();

          anonymizedRequests.add(request.id);
          return {requestHeaders};
        };

        let quietDomains = Groups.filtered[tabDomain];
        if (mainFrame) {
          const promptOption = ns.sync.TabGuardPrompt;

          const mustPrompt = promptOption !== "never" &&
            (promptOption !== "post" || request.method === "POST") &&
            (!quietDomains || [...otherDomains].some(d => !quietDomains.has(d)));

          if (mustPrompt) {
            return (async () => {
              let options = [
                {label: _("TabGuard_optAnonymize"), checked: true},
                {label: _("TabGuard_optAllow")},
              ];
              let ret = await Prompts.prompt({
                title: _("TabGuard_title"),
                message: _("TabGuard_message", [tabDomain, [...otherDomains].join(", ")]),
                options});
              if (ret.button !== 0) {
                return {cancel: true};
              }
              const groups = ret.option === 0 ? Groups.filtered : Groups.allowed;
              mergeGroups(groups, {tabDomain, otherDomains});
              return groups === Groups.filtered ? filterAuth() : null;
            })();
          }
        }
        let mustFilter = mainFrame || quietDomains && [...otherDomains].some(d => quietDomains.has(d))
        return mustFilter ? filterAuth() : null;
      })();
    },
    // must be called from a webRequest.onHeadersReceived blocking listener
    // TODO: explore DNR alternative
    onReceive(request) {
      if (!anonymizedRequests.has(request.id)) return false;
      let headersModified = false;
      let {responseHeaders} = request;
      for (let j = responseHeaders.length; j-- > 0;) {
        let h = responseHeaders[j];
        if (h.name.toLowerCase() === "set-cookie") {
          responseHeaders.splice(j, 1);
          headersModified = true;
        }
      }
      return headersModified;
    },
    // must be called after response headers have been processed or the load has been otherwise terminated
    onCleanup(request) {
      let {requestId, tabId} = request;
      if (scheduledCuts.has(requestId)) {
        scheduledCuts.delete(requestId);
        TabTies.cut(tabId);
      }
      anonymizedRequests.delete(request.id);
    },
    isAnonymizedRequest(requestId) {
      return anonymizedRequests.has(requestId);
    },
    isAnonymizedTab(tabId) {
      return anonymizedTabs.has(tabId);
    },
    getAnonymizedTabInfo(tabId) {
      // return a deep copy
      return JSON.parse(JSON.stringify(anonymizedTabs.get(tabId)));
    },
    async reloadNormally(tabId) {
      TabTies.cut(tabId);
      await browser.tabs.reload(tabId);
    },
    allow(tabId) {
      if (!TabGuard.isAnonymizedTab(tabId)) return;
      const info = this.getAnonymizedTabInfo(tabId);
      mergeGroups(Groups.allowed, info);
    }
  }
})();
