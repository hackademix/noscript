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


var TabGuard = (() => {
  (async () => { await include(["/nscl/service/TabCache.js", "/nscl/service/TabTies.js"]); })();

  let allowedGroups, filteredGroups;
  let forget = () => {
    allowedGroups = {};
    filteredGroups = {};
  };
  forget();

  const AUTH_HEADERS_RX = /^(?:authorization|cookie)/i;

  function getDomain(u) {
    let {url, siteKey} = Sites.parse(u);
    return url && url.protocol.startsWith("http") && tld.getDomain(url.hostname) || Sites.origin(siteKey);
  }

  function flattenHeaders(headers) {
    let flat = {};
    for (let h of headers) {
      flat[h.name.toLowerCase()] = h.value;
    }
    return flat;
  }

  let scheduledCuts = new Set();

  return {
    forget,
    check(request) {
      const mode = ns.sync.TabGuardMode;
      if (mode === "off" || !request.incognito && mode!== "global") return;

      const {tabId, type, url, originUrl} = request;

      if (tabId < 0) return; // no tab, no party

      if (!ns.isEnforced(tabId)) return; // leave unrestricted tabs alone

      let {requestHeaders} = request;

      let tab = TabCache.get(tabId);

      const mainFrame = type === "main_frame";
      if (mainFrame) {
        let headers = flattenHeaders(requestHeaders);
        let shouldCut = false;
        if (headers["sec-fetch-user"] === "?1") {
          // user-activated navigation
          switch(headers["sec-fetch-site"]) {
            case "same-site":
            case "same-origin":
              // cut only if same site & same tab
              shouldCut = tab && originUrl === tab.url && ![...TabTies.get(tabId)]
                .filter(tid => tid !== tabId).map(TabCache.get)
                .some(t => t && t.url === originUrl);
              break;
            case "none":
              // nav bar or bookmark
              shouldCut = true;
              break;
          }
        }
        if (shouldCut) {
          debug("[TabGuard] User-typed, bookmark or user-activated same-site-same-tab navigation: scheduling tab ties cut.", tabId, request);
          scheduledCuts.add(request.requestId);
          return;
        } else {
          debug("[TabGuard] Automatic or cross-site navigation, keeping tab ties.", tabId, request);
          scheduledCuts.delete(request.requestId);
        }
      }

      let targetDomain = getDomain(url);
      if (!targetDomain) return; // no domain, no cookies

      let tabDomain = getDomain(mainFrame ? url : tab && tab.url);
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
        await Promise.all(suspiciousTabs.map(async (tab) => {
          if (!tab._isExplicitOrigin) { // e.g. about:blank
            // let's try retrieving actual origin
            tab._externalUrl = tab.url;
            tab._isExplicitOrigin = true;
            try {
              tab.url = await browser.tabs.executeScript(tab.id, {
                runAt: "document_start",
                code: "window.origin === 'null' ? window.location.href : window.origin"
              });
            } catch (e) {
              // We don't have permissions to run in this tab, probably because it has been left empty.
              debug(e);
            }
            // If it's about:blank and it has got an opener, let's assume the opener
            // is the real origin and it's using the empty tab to run scripts.
            if (tab.url === "about:blank")  {
              if (tab.openerTabId > 0) {
                let openerTab = TabCache.get(tab.openerTabId);
                if (openerTab) {
                  tab.url = openerTab.url;
                }
              }
            }
            if (tab.url !== "about:blank") {
              debug(`Real origin for ${tab._externalUrl} (tab ${tab.id}) is ${tab.url}.`);
              if (!ns.policy.can(tab.url, "script")) return;
            }
          }
          suspiciousDomains.push(getDomain(tab.url));
        }));

        let legitDomains = allowedGroups[tabDomain] || new Set([tabDomain]);
        let otherDomains = new Set(suspiciousDomains.filter(d => d && !legitDomains.has(d)));
        if (otherDomains.size === 0) return; // no cross-site ties, no party

        if (!requestHeaders.some(h => AUTH_HEADERS_RX.test(h.name))) return; // no auth, no party

        // danger zone

        let filterAuth = () => {
          requestHeaders = requestHeaders.filter(h => !AUTH_HEADERS_RX.test(h.name));
          debug("[TabGuard] Removing auth headers from %o (%o)", request, requestHeaders);
          return {requestHeaders};
        };

        let quietDomains = filteredGroups[tabDomain];
        if (mainFrame) {
          let mustPrompt = (!quietDomains || [...otherDomains].some(d => !quietDomains.has(d)));
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
              if (ret.button !== 0) return {cancel: true};
              let list = ret.option === 0 ? filteredGroups : allowedGroups;
              otherDomains.add(tabDomain);
              for (let d of otherDomains) list[d] = otherDomains;
              return list === filteredGroups ? filterAuth() : null;
            })();
          }
        }
        let mustFilter = mainFrame || quietDomains && [...otherDomains].some(d => quietDomains.has(d))
        return mustFilter ? filterAuth() : null;
      })();
    },
    postCheck(request) {
      let {requestId, tabId} = request;
      if (scheduledCuts.has(requestId)) {
        scheduledCuts.delete(requestId);
        TabTies.cut(tabId);
      }
    },
  }
})();
