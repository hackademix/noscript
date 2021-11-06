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

"use strict";
{
  const VERSION_LABEL =  `NoScript ${browser.runtime.getManifest().version}`;
  browser.action.setTitle({title: VERSION_LABEL});
  const CSP_MARKER = "report-to noscript-reports";
  const csp = new ReportingCSP(CSP_MARKER);

  const policyTypesMap = {
      main_frame:  "",
      sub_frame: "frame",
      script: "script",
      xslt: "script",
      xbl: "script",
      font: "font",
      object: "object",
      object_subrequest: "fetch",
      xmlhttprequest: "fetch",
      ping: "ping",
      beacon: "ping",
      media: "media",
      other: "",
  };
  // add "fake" mappings for reporting capabilities handled outside of RequestGuard
  for (const cap of Permissions.ALL) {
    if (!(cap in policyTypesMap)) {
      policyTypesMap[cap] = cap;
    }
  }

  const TabStatus = {
    _session: new SessionCache(
      "RequestGuard.TabStatus",
      {
        afterLoad(data) {
          if (data) {
            TabStatus.map = new Map(data.map);
            TabStatus._originsCache = new Map(data._originsCache);
          }
        },
        beforeSave() { // beforeSave
          return {
            map: [...TabStatus.map],
            _originsCache: [...TabStatus._originsCache],
          };
        },
      }
    ),
    init() {
      for (const event of ["Activated", "Updated", "Removed"]) {
        browser.tabs[`on${event}`].addListener(TabStatus[`on${event}Tab`]);
      }
      (async () => {
        await TabStatus._session.load();
        TabStatus.updateTab();
      });
    },
    map: new Map(),
    _originsCache: new Map(),
    newRecords() {
      return {
        allowed: {},
        blocked: {},
        noscriptFrames: {},
        origins: new Set(),
      }
    },
    hasOrigin(tabId, url) {
      let records = this.map.get(tabId);
      return records?.origins.has(Sites.origin(url));
    },
    addOrigin(tabId, url) {
      if (tabId < 0) return;
      let origin = Sites.origin(url);
      if (!origin) return;
      let {origins} = this.map.get(tabId) || this.initTab(tabId);
      if (!origins.has(origin)) {
        origins.add(origin);
        this._originsCache.clear();
      }
    },

    findTabsByOrigin(origin) {
      let tabIds = this._originsCache.get(origin);
      if (!tabIds) {
        tabIds = [];
        for(let [tabId, {origins}] of [...this.map]) {
          if (origins.has(origin)) tabIds.push(tabId);
        }
        this._originsCache.set(origin, tabIds);
      }
      return tabIds;
    },
    initTab(tabId, records = this.newRecords()) {
      if (tabId < 0) return;
      this.map.set(tabId, records);
      this._session.save();
      return records;
    },
    _record(request, what, optValue) {
      let {tabId, frameId, type, url, documentUrl} = request;
      let policyType = policyTypesMap[type] || type;
      let requestKey = Policy.requestKey(url, policyType, documentUrl);
      let {map} = this;
      let records = map.has(tabId) ?  map.get(tabId) : this.initTab(tabId);
      if (what === "noscriptFrame" && type !== "object") {
        let nsf = records.noscriptFrames;
        nsf[frameId] = optValue;
        what = optValue ? "blocked" : "allowed";
        if (frameId === 0) {
          request.type = type = "main_frame";
          Content.reportTo(request, optValue, type);
        }
      }
      if (type.endsWith("frame")) {
        this.addOrigin(tabId, url);
      } else if (documentUrl) {
        this.addOrigin(tabId, documentUrl);
      }
      let collection = records[what];
      if (collection) {
        if (type in collection) {
          if (!collection[type].includes(requestKey)) {
            collection[type].push(requestKey);
          }
        } else {
          collection[type] = [requestKey];
        }
      }
      this._session.save();
      return records;
    },
    record(request, what, optValue) {
      let {tabId} = request;
      if (tabId < 0) return;
      let records = this._record(request, what, optValue);
      if (records) {
        this.updateTab(request.tabId);
      }
    },
    _pendingTabs: new Set(),
    async updateTab(tabId) {
      tabId ??= (await browser.tabs.getCurrent())?.tabId;
      if (!(tabId >= 0)) return;
      if (this._pendingTabs.size === 0) {
        setTimeout(() => { // clamp UI updates
          for (let tabId of this._pendingTabs) {
            this._updateTabNow(tabId);
          }
          this._pendingTabs.clear();
        }, 200);
      }
      this._pendingTabs.add(tabId);
    },
    _updateTabNow(tabId) {
      this._pendingTabs.delete(tabId);
      let records = this.map.get(tabId) || this.initTab(tabId);

      let {allowed, blocked, noscriptFrames} = records;
      let topAllowed = !(noscriptFrames && noscriptFrames[0]);
      let numAllowed = 0, numBlocked = 0, sum = 0;
      let report = Permissions.ALL.map(t => {
        let a = allowed[t] && allowed[t].length || 0,
            b = blocked[t] && blocked[t].length || 0,
            s = a + b;
        numAllowed += a;
        numBlocked += b;
        sum += s;
        return s && `<${t}>: ${b}/${s}`;
      }).filter(s => s).join("\n");
      let enforced = ns.isEnforced(tabId);
      let icon = enforced ?
        (topAllowed ? (numBlocked ? "part" : "yes")
        : (numAllowed ? "sub" : "no")) // not topAllowed
        : "global"; // not enforced
      let showBadge = ns.local.showCountBadge && numBlocked > 0;
      let {action} = browser;
      if (!action.setIcon) { // Fennec
        action.setTitle({tabId, title: `NoScript (${numBlocked})`});
        return;
      }
      (async () => {
        let iconPath = (await Themes.isVintage()) ? '/img/vintage' : '/img';
        action.setIcon({tabId, path: {64: `${iconPath}/ui-${icon}64.png`}});
      })();

      action.setBadgeText({
        tabId,
        text: TabGuard.isAnonymizedTab(tabId) ? "TG" : showBadge ? numBlocked.toString() : ""
      });
      action.setBadgeBackgroundColor({tabId, color: [128, 0, 0, 160]});
      action.setTitle({tabId,
        title: UA.mobile ? "NoScript" : `${VERSION_LABEL} \n${enforced ?
            _("BlockedItems", [numBlocked, numAllowed + numBlocked]) + ` \n${report}`
            : _("NotEnforced")}`
      });
    },
    async probe(tabId) {
      if (tabId === undefined) {
        (await browser.tabs.query({})).forEach(tab => TabStatus.probe(tab.id));
      } else {
        try {
          TabStatus.recordAll(tabId, await ns.collectSeen(tabId));
        } catch (e) {
          error(e);
        }
      }
    },
    recordAll(tabId, seen) {
      if (seen) {
        let records = TabStatus.map.get(tabId);
        if (records) {
          records.allowed = {};
          records.blocked = {};
        }
        for (let thing of seen) {
          let {request, allowed} = thing;
          request.tabId = tabId;
          debug(`Recording`, request); // DEV_ONLY
          TabStatus._record(request, allowed ? "allowed" : "blocked");
          if (request.key === "noscript-probe" && request.type === "main_frame" ) {
            request.frameId = 0;
            TabStatus._record(request, "noscriptFrame", !allowed);
          }
        }
        this._updateTabNow(tabId);
      }
    },
    async onActivatedTab(info) {
      let {tabId} = info;
      let seen = await ns.collectSeen(tabId);
      TabStatus.recordAll(tabId, seen);
    },
    onUpdatedTab(tabId, changeInfo) {
      if (changeInfo.url) {
        TabStatus.initTab(tabId);
      }
    },
    onRemovedTab(tabId) {
      TabStatus.map.delete(tabId);
      TabStatus._originsCache.clear();
      TabStatus._pendingTabs.delete(tabId);
    },
  };
  TabStatus.init();

  const messageHandler = {

    async pageshow(message, sender) {
      if (sender.frameId === 0) {
        TabStatus.recordAll(sender.tab.id, message.seen);
      } else if (sender.tab) {
        // merge subframes records back into main frame's seen report
        const tabId = sender.tab.id;
        for (const {request, allowed, policyType} of message.seen) {
          request.tabId = tabId;
          request.frameId = sender.frameId;
          Content.reportTo(request, allowed, policyType);
        }
      }
      return true;
    },

    // returns true if it's a true violation (request should be blocked)
    violation({url, type, isReport}, sender) {
      const {tab, frameId} = sender;
      const documentUrl = sender.url;

      let request = {
        url,
        type,
        tabId: tab.id,
        tabUrl: tab.url,
        frameId,
        documentUrl,
        originUrl: documentUrl,
      };

      debug("CSP", isReport ? "report" : "violation", request, sender); // DEV_ONLY

      if (isReport && !checkRequest(request)?.cancel) {
        // not a real violation
        return false;
      }

      Content.reportTo(request, false, policyTypesMap[type]);

      if (type === "script" && url === sender.url) {
        TabStatus.record(request, "noscriptFrame", true);
      } else {
        TabStatus.record(request, "blocked");
      }

      return true;
    },

    async blockedObjects(message, sender) {
      let {url, documentUrl, policyType} = message;
      let TAG = `<${policyType.toUpperCase()}>`;

      const useDirs = policyType === "x-load";
      const normalize = useDirs ? Sites.trimToDir : u => u;
      url = normalize(url);
      const contextUrl = normalize(sender.tab.url || documentUrl);
      const ctxKey = Sites.optimalKey(contextUrl);

      let origin = Sites.origin(url);
      const {siteKey} = Sites.parse(url);

      const forcedTemp = sender.tab.incognito;

      const allowLabel = forcedTemp ? "allowTemp" : "allowLocal";

      const options = [
        {
          label: _(allowLabel, siteKey),
          checked: true,
          _key: siteKey,
        },
      ];
      if (!(url.startsWith("blob:") || useDirs)) {
        if (siteKey === origin) {
          origin = new URL(url).protocol;
        }
        options.push({ label: _(allowLabel, origin), _key: origin });
      }

      options.push({ label: _("CollapseBlockedObjects"), _collapse: true });

      const checks = [
        { label: _("capsContext") + `\n${ctxKey}`, checked: true, _val: "ctx" },
      ];

      if (!forcedTemp) {
        checks.unshift(
          { label: _("allowTemp", TAG), checked: true, _val: "temp" },
        );
      }

      let ret = await Prompts.prompt({
        title: _("BlockedObjects"),
        message: _(allowLabel, TAG),
        options,
        checks,
      });

      debug(`Prompt returned`, ret, sender); // DEV_ONLY

      if (ret.button !== 0) return;

      const choice = options[ret.option];
      if (choice._collapse) {
        return { collapse: "all" };
      }

      const key = choice._key;
      if (!key) return;

      const checked = ret.checks.map((i) => checks[i]._val);

      const wantsContext = checked.includes("ctx");

      let cookieStoreId = sender.tab && sender.tab.cookieStoreId;
      let policy = ns.getPolicy(cookieStoreId);
      let { siteMatch, contextMatch, perms } = policy.get(key, contextUrl);

      if (!perms.capabilities.has(policyType) ||
          !contextMatch && wantsContext && ctxKey) {

        const wantsTemp = forcedTemp || checked.includes("temp");
        if (!contextMatch) {
          const isDefault = perms === ns.policy.DEFAULT;
          perms = perms.clone();
          if (isDefault) perms.temp = wantsTemp;
          policy.set(key, perms);
          if (ctxKey && wantsContext) {
            perms.contextual.set(ctxKey, perms = perms.clone(/* noContext = */ true));
          }
        }
        perms.temp = wantsTemp;
        perms.capabilities.add(policyType);
        await ns.savePolicy();
        await ns.saveContextStore();
        await RequestGuard.DNRPolicy?.update();
      }
      return {enable: key};
    },
  };

  const Content = {
    _session: new SessionCache("RequestGuard.Content", {
      afterLoad(data) {
        if (data.tabLess?.requests) {
          Content._tabLess = Object.assign({}, data.tabLess);
          Content._tabLess.requests = new Map(data.tabLess.requests);
        }
      },
      beforeSave() {
        // beforeSave
        if (!Content._tabLess) {
          return;
        }
        const tabLess = Object.assign({}, Content._tabLess);
        tabLess.requests = [...tabLess.requests];
        return {
          tabLess,
        };
      },
    }),
    _tabLess: null,
    async getTabLess() {
      if (!this._tabLess) await this._session.load();
      return (this._tabLess ||= { requests: new Map() });
    },

    async checkTabLessRequest(request, candidate) {
      if (request.tabId !== -1) {
        // belts and suspenders
        return;
      }
      // called from an onBeforeSendHeaders listener, with request headers
      const tabLess = await this.getTabLess();
      if (request.frameId == 0 && request.type == "main_frame") {
        if (request.documentUrl) {
          // main_frame request from service worker
          return;
        }
        const { url } = request;
        if (tabLess.mainUrl == url) {
          // same chatbot as before, probably closed & reopened, bailout
          return;
        }
        // filter out requests with wrong headers, e.g. prefetches
        for (let h of request.requestHeaders) {
          switch(h.name) {
            case 'Sec-Fetch-Dest':
              if (h.value !== "document") {
                return;
              }
              break;
            case 'Sec-Fetch-Mode':
              if (h.value !== "navigate") {
                return;
              }
              break;
            case 'Sec-Fetch-Site':
              if (h.value !== "cross-site") {
                return;
              }
              break;
            case 'Sec-Purpose':
              // prefetch
              return;
          }
        }
        await include("/nscl/service/SidebarUtil.js");
        const sidebarWidth = await SidebarUtil.guessSidebarWidth();
        if (sidebarWidth < 400) {
          // sidebar is closed, bailout
          return;
        }
        tabLess.sidebarWidth = sidebarWidth;
        tabLess.requests.clear();
        tabLess.mainUrl = url;
      } else if (
        !tabLess?.requests?.size ||
        tabLess.mainUrl !==
          (request?.frameAncestors?.length
            ? request.frameAncestors[
                request.frameAncestors?.length - 1]?.url
            : request.documentUrl)
      ) {
        // at least one top document needs to be loaded and it must match
        return;
      }
      tabLess.requests.set(candidate.request.key, candidate);
      this._session.save();
    },

    async reportTo(originalRequest, allowed, policyType) {
      const { requestId, tabId, frameId, type, url, documentUrl, originUrl } =
        originalRequest;
      const pending = pendingRequests.get(requestId); // null if from a CSP report

      const request = {
        key: Policy.requestKey(
          url,
          type,
          documentUrl || "",
          /^(media|object|frame)$/.test(type)
        ),
        type,
        url,
        documentUrl,
        originUrl,
      };

      if (tabId < 0) {
        if (Sites.isInternal(url)) {
          return;
        }
        if (
          (policyType === "script" || policyType === "fetch") &&
          url.startsWith("https://") &&
          documentUrl?.startsWith("https://")
        ) {
          // service worker request ?
          const payload = {
            request,
            allowed,
            policyType,
            serviceWorker: Sites.origin(documentUrl),
          };
          const recipient = { frameId: 0 };
          for (const tabId of TabStatus.findTabsByOrigin(payload.serviceWorker)) {
            recipient.tabId = tabId;
            try {
              Messages.send("seen", payload, recipient);
            } catch (e) {
              // likely a privileged tab where our content script couldn't run
            }
          }
          if (recipient.tabId) {
            // we've linked at least one owner tab
            return;
          }
        }
        if ((pending && UA.isMozilla)) {
          // we only support tab-less / sidebars in Firefox
          pending.tabLessCandidate = {
            request,
            allowed,
            policyType,
            tabLess: true,
          };
        }
        return;
      }
      if (pending) request.initialUrl = pending.initialUrl;
      if (type !== "sub_frame") {
        // we couldn't deliver it to frameId, since it's generally not loaded yet
        try {
          await Messages.send(
            "seen",
            { request, allowed, policyType, ownFrame: true },
            { tabId, frameId }
          );
        } catch (e) {
          debug(
            `Couldn't deliver "seen" message for ${type}@${url} ${
              allowed ? "A" : "F"
            } to document ${documentUrl} (${frameId}/${tabId})`,
            e
          );
        }
      }
      if (frameId === 0) return;
      try {
        await Messages.send(
          "seen",
          { request, allowed, policyType },
          { tabId, frameId: 0 }
        );
      } catch (e) {
        debug(
          `Couldn't deliver "seen" message to top frame containing ${documentUrl} (${frameId}/${tabId}`,
          e
        );
      }
    },
  };

  const pendingRequests = new Map();
  function initPendingRequest(request) {
    let { requestId, url } = request;
    let redirected = pendingRequests.get(requestId);
    let initialUrl = redirected ? redirected.initialUrl : url;
    pendingRequests.set(requestId, {
      initialUrl,
      url,
      redirected,
      onCompleted: new Set(),
    });
    return redirected;
  }

  let normalizeRequest = request => {

    function fakeOriginFromTab({tabId, type} = request) {
      if (type !== "main_frame") {
        let tabUrl = request.tabUrl || tabId !== -1 && TabCache.get(tabId)?.url;
        if (tabUrl) {
          return request.initiator = request.originUrl = request.documentUrl = tabUrl;
        }
      }
      return request.initiator || request.originUrl;
    }

    if ("initiator" in request && !("originUrl" in request)) {
      if (request.initiator === "null") {
        // Chromium sandboxed content?
        fakeOriginFromTab();
      }
      request.originUrl = request.initiator;
      if (request.type !== "main_frame" && !("documentUrl" in request)) {
        request.documentUrl = request.initiator;
      }
    }
    if ("frameAncestors" in request && (!request.originUrl || request.documentUrl)) {
      // Gecko sandboxed content?
      for (let f of request.frameAncestors) {
        if (f.url !== "null" && !f.url.startsWith("moz-nullprincipal:")) {
          request.originUrl = request.documentUrl = f.url;
          break;
        }
      }
      if (!request.originUrl) {
        fakeOriginFromTab();
      }
    }
  };

  function intersectCapabilities(policyMatch, request) {
    if (request.frameId !== 0 && ns.sync.cascadeRestrictions) {
      const {tabUrl, frameAncestors, cookieStoreId} = request;
      const topUrl = tabUrl ||
        frameAncestors && frameAncestors[frameAncestors?.length - 1]?.url ||
        TabCache.get(request.tabId)?.url;
      if (topUrl) {
        const policy = ns.getPolicy(cookieStoreId);
        return policy.cascadeRestrictions(policyMatch, topUrl).capabilities;
      }
    }
    return policyMatch.perms.capabilities;
  }

  const ABORT = {cancel: true},
        ALLOW = {};

  const recent = {
    MAX_AGE: 500,
    _pendingGC: 0,
    _byUrl: new Map(),
    find(request, last = this._byUrl.get(request.url)) {
      if (!last) return null;
      for (let j = last.length; j-- > 0;) {
        let other = last[j];
        if (request.timeStamp - other.timeStamp > this.MAX_AGE) {
          last.splice(0, ++j);
          if (last.length === 0) this._byUrl.delete(other.url);
          break;
        }
        if (request.url && other.type === request.type && other.documentUrl === request.documentUrl
          && other.tabId === request.tabId && other.frameId === request.frameId) {
          return other;
        }
      }
      return null;
    },
    add(request) {
      request.timeStamp ??= Date.now();
      let last = this._byUrl.get(request.url);
      if (!last) {
        last = [request];
        this._byUrl.set(request.url, last);
      } else {
        last.push(request);
      }
      this._gc();
      return;
    },
    _gc(now) {
      if (!now && this._pendingGC) return;
      debug("Recent requests garbage collection."); // DEV_ONLY
      let request = {timeStamp: Date.now()};
      for (let last of this._byUrl.values()) {
        this.find(request, last);
      }
      this._pendingGC = this._byUrl.size ?
         setTimeout(() => this._gc(true), 1000)
         : 0;
    }
  };


  function blockLANRequest(request) {
    debug("WAN->LAN request blocked", request);
    let r = Object.assign({}, request);
    r.url = request.originUrl; // we want to report the origin as needing the permission
    Content.reportTo(r, false, "lan")
    return ABORT;
  }

  function checkLANRequest(request) {
    if (!ns.isEnforced(request.tabId)) return ALLOW;
    let {originUrl, url, cookieStoreId} = request;
    let policy = ns.getPolicy(cookieStoreId);
    if (originUrl && !Sites.isInternal(originUrl) && url.startsWith("http") &&
      !policy.can(originUrl, "lan", ns.policyContext(request))) {
      // we want to block any request whose origin resolves to at least one external WAN IP
      // and whose destination resolves to at least one LAN IP
      const {proxyInfo} = request; // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/ProxyInfo
      const neverDNS = (proxyInfo?.type?.startsWith("http") || proxyInfo?.proxyDNS)
                     || !(UA.isMozilla && DNS.supported);
      if (neverDNS) {
        // On Chromium we must do it synchronously: we need to sacrifice DNS resolution and check just numeric addresses :(
        // (the Tor Browser, on the other hand, does DNS resolution and boundary checks on its own and breaks the DNS API)
        return iputil.isLocalURI(url, false, neverDNS) && !iputil.isLocalURI(originUrl, true, neverDNS)
          ? blockLANRequest(request)
          : ALLOW;
      }
      // Firefox does support asynchronous webRequest: let's return a Promise and perform DNS resolution.
      return new Promise(async (resolve, reject) => {
        try {
          resolve(await iputil.isLocalURI(url, false) && !(await iputil.isLocalURI(originUrl, true))
            ? blockLANRequest(request)
            : ALLOW
          );
        } catch (e) {
          reject(e);
        }
      });
    }
  }

  // returns null if request.type is unknown, otherwise either ALLOW, ABORT or a redirect response
  function checkRequest(request) {
    if (!(request.type in policyTypesMap)) {
      return null;
    }

    normalizeRequest(request);

    let {tabId, type, cookieStoreId, url, originUrl} = request;

    const policy = ns.getPolicy(cookieStoreId);

    let previous = recent.find(request);
    if (previous) {
      debug("Rapid fire request", previous); // DEV_ONLY
      return previous.return;
    }
    (previous = request).return = ALLOW;
    recent.add(previous);

    let policyType = policyTypesMap[type];
    let {documentUrl} = request;
    if (!ns.isEnforced(tabId)) {
      if (ns.unrestrictedTabs.has(tabId) && type.endsWith("frame") && url.startsWith("https:")) {
        TabStatus.addOrigin(tabId, url);
      }
      if (type !== "main_frame") {
        Content.reportTo(request, true, policyType);
      }
      return ALLOW;
    }
    let isFetch = "fetch" === policyType;

    if ((isFetch || "frame" === policyType) &&
        (((isFetch && !originUrl
          || url === originUrl) && originUrl === documentUrl
          // some extensions make them both undefined,
          // see https://github.com/eight04/image-picka/issues/150
        ) ||
        Sites.isInternal(originUrl))
    ) {
      // livemark request or similar browser-internal, always allow;
      return ALLOW;
    }

    if (/^(?:data|blob):/.test(url)) {
      request._dataUrl = url;
      request.url = url = documentUrl || originUrl;
    }

    let allowed = Sites.isInternal(url);
    if (!allowed) {
      if (tabId < 0 && documentUrl?.startsWith("https:")) {
        allowed = [...ns.unrestrictedTabs]
          .some(tabId => TabStatus.hasOrigin(tabId, documentUrl));
      }
      if (!allowed) {
        const capabilities = intersectCapabilities(
          policy.get(url, ns.policyContext(request)),
          request);
        allowed = !policyType || capabilities.has(policyType);
        if (allowed && request._dataUrl && type.endsWith("frame")) {
          let blocker = csp.buildFromCapabilities(capabilities);
          if (blocker) {
            let redirectUrl = CSP.patchDataURI(request._dataUrl, blocker);
            if (redirectUrl !== request._dataUrl) {
              return previous.return = {redirectUrl};
            }
          }
        }
      }
    }

    if (type !== "main_frame" || tabId < 0) {
      Content.reportTo(request, allowed, policyType);
    }

    if (!allowed) {
      debug(`${policyType} must be blocked`, request);
      TabStatus.record(request, "blocked");
      return previous.return = ABORT;
    }

    return ALLOW;
  }


  const listeners = {
    onBeforeRequest(request) {
      try {
        if (browser.runtime.onSyncMessage?.isMessageRequest(request)) {
          return ALLOW;
        }
        initPendingRequest(request);

        let result = checkRequest(request);
        if (result) return result;

      } catch (e) {
        error(e);
      }
      return ALLOW;
    },

    onBeforeSendHeaders(request) {
      normalizeRequest(request);
      let lanRes = checkLANRequest(request);
      if (!UA.isMozilla) {
        // Chromium doesn't support async blocking suspension, stop here
        // (Skip TabGuard on Chromium/MV3 until alternative tech is available)
        return lanRes;
      }
      if (lanRes === ABORT) return ABORT;

      const pending = pendingRequests.get(request.requestId);
      // redirection loop test
      if (pending?.redirected?.url === request.url) {
        return lanRes; // don't go on stripping cookies if we're in a redirection loop
      }
      const chainNext = r =>
          r === ABORT
            ? r
            : pending.tabLessCandidate
              ? Content.checkTabLessRequest(request, pending.tabLessCandidate)
              : TabGuard.onSend(request);
      return lanRes instanceof Promise ? lanRes.then(chainNext) : chainNext(lanRes);
    },

    onHeadersReceived(request) {
      // called for main_frame, sub_frame and object

      // check for duplicate calls
      let pending = pendingRequests.get(request.requestId);
      if (pending) {
        if (pending.headersProcessed) {
          if (!request.fromCache) {
            debug("Headers already processed, skipping ", request); // DEV_ONLY
            return ALLOW;
          }
          debug("Reprocessing headers for cached request ", request); // DEV_ONLY
        } else {
          debug("onHeadersReceived", request);  // DEV_ONLY
        }
      } else {
        debug("[WARNING] no pending information for ", request); // DEV_ONLY
        initPendingRequest(request);
        pending = pendingRequests.get(request.requestId);
      }
      if (request.fromCache && listeners.onHeadersReceived.resetCSP && !pending.resetCachedCSP) {
        debug("Resetting CSP Headers"); // DEV_ONLY
        pending.resetCachedCSP = true;
        let {responseHeaders} = request;
        let headersCount = responseHeaders.length;
        let purged = false;
        responseHeaders.forEach((h, index) => {
          if (csp.isMine(h)) {
            responseHeaders.splice(index, 1);
          }
        });
        if (headersCount > responseHeaders.length) {
          debug("Resetting cached NoScript CSP header(s)", request); // DEV_ONLY
          return {responseHeaders};
        }
      }

      normalizeRequest(request);
      let result = ALLOW;
      let promises = [];

      pending.headersProcessed = true;
      let {url, documentUrl, tabId, cookieStoreId, responseHeaders, type} = request;
      let isMainFrame = type === "main_frame";
      try {
        let capabilities;
        if (ns.isEnforced(tabId)) {
          const policy = ns.getPolicy(cookieStoreId);
          const policyMatch = policy.get(url, ns.policyContext(request));
          let { perms } = policyMatch;
          if (isMainFrame) {
            const autoPerms = policy.autoAllow(url, perms);
            if (autoPerms) {
              perms = autoPerms;
            }
            capabilities = perms.capabilities;
          } else {
            capabilities = intersectCapabilities(policyMatch, request);
          }
        } // else unrestricted, either globally or per-tab
        if (isMainFrame && !TabStatus.map.has(tabId)) {
          debug("No TabStatus data yet for noscriptFrame", tabId); // DEV_ONLY
          TabStatus.record(request, "noscriptFrame",
            capabilities && !capabilities.has("script"));
        }
        let header = csp.patchHeaders(responseHeaders, capabilities);
        let headersModified = TabGuard.onReceive(request);
        /*
        // Uncomment me to disable networking-level CSP for debugging purposes
        header = null;
        */
        if (header) {
          pending.cspHeader = header;
          debug(`CSP blocker on %s:`, url, header.value); // DEV_ONLY
          headersModified = true;
        }
        if (headersModified) {
          result = {responseHeaders};
          debug("Headers changed ", request);  // DEV_ONLY
        }
      } catch (e) {
        error(e, "Error in onHeadersReceived", request);
      }

      promises = promises.filter(p => p instanceof Promise);
      if (promises.length > 0) {
        return Promise.allSettled(promises).then(() => result);
      }

      return result;
    },
    onResponseStarted(request) {
      normalizeRequest(request);
      debug("onResponseStarted", request); // DEV_ONLY
      let {requestId, url, tabId, frameId, type} = request;
      if (type === "main_frame") {
        TabStatus.initTab(tabId);
        TabGuard.onCleanup(request);
      }
      if (!RequestGuard.canBlock) {
        return;
      }
      let scriptBlocked = request.responseHeaders.some(
        h => csp.isMine(h) && CSP.blocks(h.value, "script")
      );
      debug("%s scriptBlocked=%s setting noscriptFrame on ", url, scriptBlocked, tabId, frameId); // DEV_ONLY
      TabStatus.record(request, "noscriptFrame", scriptBlocked);
      let pending = pendingRequests.get(requestId);
      if (pending) {
        pending.scriptBlocked = scriptBlocked;
        if (!(pending.headersProcessed &&
            (scriptBlocked || ns.requestCan(request, "script"))
          )) {
          debug("[WARNING] onHeadersReceived %s %o", frameId, tabId,
            pending.headersProcessed ? "has been overridden on": "could not process",
            request);
        }
      }
    },
    onCompleted(request) {
      let {requestId} = request;
      if (pendingRequests.has(requestId)) {
        let r = pendingRequests.get(requestId);
        pendingRequests.delete(requestId);
        for (let callback of r.onCompleted) {
          try {
            callback(request, r);
          } catch (e) {
            error(e);
          }
        }
      }
      TabGuard.onCleanup(request);
    },
    onErrorOccurred(request) {
      pendingRequests.delete(request.requestId);
      TabGuard.onCleanup(request);
    }
  };

  async function injectPolicyScript(details) {
    await ns.initializing;
    if (ns.local.debug?.disablePolicyInjection) return '';  // DEV_ONLY
    const {url, tabId, frameId, cookieStoreId, type} = details;
    const isTop = type == "main_frame";
    const domPolicy = await ns.computeChildPolicy(
      { url },
      {
        tab: { id: tabId, url: isTop ? url : null },
        frameId: isTop ? 0 : frameId,
        cookieStoreId,
      }
    );
    domPolicy.navigationURL = url;
    const callback = "ns_setupCallback";
    if (DocStartInjection.mv3Callbacks) {
      return {
        data: {domPolicy},
        callback,
        assign: "ns",
      };
    }
    let debugStatement = ns.local.debug ? `
      let mark = Date.now() + ":" + Math.random();
      console.debug("domPolicy", domPolicy, document.readyState, location.href, mark, window.ns, document.documentElement);` : '';
    return `
      const domPolicy = ${JSON.stringify(domPolicy)};
      if (globalThis.${callback}) {
        globalThis.${callback}(domPolicy);
      } else {
        (globalThis.ns ||= {}).domPolicy = domPolicy;
      }
      ${debugStatement}`;
  }

  // external interface
  globalThis.RequestGuard = {
    canBlock: UA.isMozilla,
    DNRPolicy: null,
    policyTypesMap,
    async getTabLess() {
      const tabLess = Object.assign({}, await Content.getTabLess());
      tabLess.requests = [... tabLess.requests.values()]
      return tabLess;
    }
  };

  // initialization
  {
    Messages.addHandler(messageHandler);
    const wr = browser.webRequest;
    const listen = (what, ...args) => wr[what].addListener(listeners[what], ...args);
    const allUrls = ["<all_urls>"];
    const docTypes = ["main_frame", "sub_frame", "object"];
    const filterDocs = {urls: allUrls, types: docTypes};
    const filterAll = {urls: allUrls};

    listen("onBeforeRequest", filterAll,
        RequestGuard.canBlock ? ["blocking"] : []);
    listen("onResponseStarted", filterDocs, ["responseHeaders"]);
    listen("onCompleted", filterAll);
    listen("onErrorOccurred", filterAll);
    DocStartInjection.register(injectPolicyScript);
    TabStatus.probe();

    if (!RequestGuard.canBlock) {
      include("/nscl/service/NavCache.js");
      include("/bg/DNRPolicy.js");
    } else {
      // From here on, only webRequestBlocking-enabled code (Gecko MV2.5)
      listen("onBeforeSendHeaders", filterAll, ["blocking", "requestHeaders"]);

      const mergingCSP = true; // TODO: check whether it's still true...
      if (mergingCSP) {
        // In Gecko>=77 (https://bugzilla.mozilla.org/show_bug.cgi?id=1462989)
        // we need to cleanup our own cached headers in a dedicated listener :(
        // see also https://trac.torproject.org/projects/tor/ticket/34305
        wr.onHeadersReceived.addListener(
          listeners.onHeadersReceived.resetCSP = request => {
            return listeners.onHeadersReceived(request);
          }, filterDocs, ["blocking", "responseHeaders"]);
      }
      listen("onHeadersReceived", filterDocs, ["blocking", "responseHeaders"]);
      // Still, other extensions may accidentally delete our CSP header
      // if called before us, hence we try our best reinjecting it in the end
      (listeners.onHeadersReceivedLast =
        new LastListener(wr.onHeadersReceived, request => {
        const pending = pendingRequests.get(request.requestId);
        if (pending?.headersProcessed) {
          const {cspHeader} = pending;
          if (cspHeader) {
            const {responseHeaders} = request;
            responseHeaders.push(cspHeader);
            return {responseHeaders};
          }
        } else {
          debug("[WARNING] onHeadersReceived not called (yet?)", request);
        }
        return ALLOW;
      }, filterDocs, ["blocking", "responseHeaders"])).install();
    }
  }
}
