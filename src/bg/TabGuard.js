/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2022 Giorgio Maone <https://maone.net>
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
    let {url} = Sites.parse(u);
    return url && url.protocol.startsWith("http") && tld.getDomain(url.hostname);
  }

  return {
    forget,
    check(request) {
      const mode = ns.sync.TabGuardMode;
      if (mode === "off" || !request.incognito && mode!== "global") return;

      const {tabId, type, url} = request;

      if (tabId < 0) return; // no tab, no party

      let targetDomain = getDomain(url);
      if (!targetDomain) return; // no domain, no cookies

      const mainFrame = type === "main_frame";
      let tabDomain = getDomain(mainFrame ? url : TabCache.get(tabId).url);
      if (!tabDomain) return; // no domain, no cookies

      let ties = TabTies.get(tabId);
      if (ties.size === 0) return; // no ties, no party

      let legitDomains = allowedGroups[tabDomain] || new Set([tabDomain]);

      let otherDomains = new Set([...ties].map(id => getDomain(TabCache.get(id).url)).filter(d => !legitDomains.has(d)));
      if (otherDomains.size === 0) return; // no cross-site ties, no party

     let {requestHeaders} = request;

      if (!requestHeaders.some(h => AUTH_HEADERS_RX.test(h.name))) return; // no auth, no party

      // danger zone

      let filterAuth = () => {
        requestHeaders = requestHeaders.filter(h => !AUTH_HEADERS_RX.test(h.name));
        debug("TabGuard removing auth headers from %o (%o)", request, requestHeaders);
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
            if (ret.button === 1) return {cancel: true};
            let list = ret.option === 0 ? filteredGroups : allowedGroups;
            otherDomains.add(tabDomain);
            for (let d of otherDomains) list[d] = otherDomains;
            return list === filteredGroups ? filterAuth() : null;
          })();
        }
      }
      let mustFilter = mainFrame || quietDomains && [...otherDomains].some(d => quietDomains.has(d))
      return mustFilter ? filterAuth() : null;
    }
  }
})();
