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

var RequestGuard = (() => {
  'use strict';
  const VERSION_LABEL =  `NoScript ${browser.runtime.getManifest().version}`;
  browser.browserAction.setTitle({title: VERSION_LABEL});
  const CSP_REPORT_URI = "https://noscript-csp.invalid/__NoScript_Probe__/";
  const CSP_MARKER = "noscript-marker";
  let csp = new ReportingCSP(CSP_MARKER, CSP_REPORT_URI);
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

  Object.assign(policyTypesMap, {"webgl": "webgl"}); // fake types
  const TabStatus = {
    map: new Map(),
    _originsCache: new Map(),
    types: ["script", "object", "media", "frame", "font"],
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
      return records && records.origins.has(Sites.origin(url));
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
    updateTab(tabId) {
      if (tabId < 0) return;
      if (this._pendingTabs.size === 0) {
        window.setTimeout(() => { // clamp UI updates
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
      let report = this.types.map(t => {
        let a = allowed[t] && allowed[t].length || 0,
            b = blocked[t] && blocked[t].length || 0,
            s = a + b;
        numAllowed += a;
        numBlocked += b;
        sum += s;
        return s && `<${t === "sub_frame" ? "frame" : t}>: ${b}/${s}`;
      }).filter(s => s).join("\n");
      let enforced = ns.isEnforced(tabId);
      let icon = enforced ?
        (topAllowed ? (numBlocked ? "part" : "yes")
        : (numAllowed ? "sub" : "no")) // not topAllowed
        : "global"; // not enforced
      let showBadge = ns.local.showCountBadge && numBlocked > 0;
      let browserAction = browser.browserAction;
      if (!browserAction.setIcon) { // Fennec
        browserAction.setTitle({tabId, title: `NoScript (${numBlocked})`});
        return;
      }
      (async () => {
        let iconPath = (await Themes.isVintage()) ? '/img/vintage' : '/img';
        browserAction.setIcon({tabId, path: {64: `${iconPath}/ui-${icon}64.png`}});
      })();
      browserAction.setBadgeText({tabId, text: showBadge ? numBlocked.toString() : ""});
      browserAction.setBadgeBackgroundColor({tabId, color: [128, 0, 0, 160]});
      browserAction.setTitle({tabId,
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
          debug(`Recording`, request);
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
  }
  for (let event of ["Activated", "Updated", "Removed"]) {
    browser.tabs[`on${event}`].addListener(TabStatus[`on${event}Tab`]);
  }

  let messageHandler = {
    async pageshow(message, sender) {
      if (sender.frameId === 0) {
        TabStatus.recordAll(sender.tab.id, message.seen);
      }
      return true;
    },
    violation({url, type}, sender) {
      let tabId = sender.tab.id;
      let {frameId} = sender;
      let r = {
        url, type, tabId, frameId, documentUrl: sender.url
      };
      Content.reportTo(r, false, policyTypesMap[type]);
      debug("Violation", type, url, tabId, frameId);
      if (type === "script" && url === sender.url) {
        TabStatus.record(r, "noscriptFrame", true);
      } else {
        TabStatus.record(r, "blocked");
      }
    },
    async blockedObjects(message, sender) {
      let {url, documentUrl, policyType} = message;
      let TAG = `<${policyType.toUpperCase()}>`;
      let origin = Sites.origin(url);
      let {siteKey} = Sites.parse(url);
      let options;
      if (siteKey === origin) {
        origin = new URL(url).protocol;
      }
      options = [
        {label: _("allowLocal", siteKey), checked: true},
        {label: _("allowLocal", origin)},
        {label: _("CollapseBlockedObjects")},
      ];
      let t = u => `${TAG}@${u}`;
      let ret = await Prompts.prompt({
        title: _("BlockedObjects"),
        message: _("allowLocal", TAG),
        options});
      debug(`Prompt returned`, ret, sender);
      if (ret.button !== 0) return;
      if (ret.option === 2) {
        return {collapse: "all"};
      }
      let key = [siteKey, origin][ret.option || 0];
      if (!key) return;
      let contextUrl = sender.tab.url || documentUrl;
      let {siteMatch, contextMatch, perms} = ns.policy.get(key, contextUrl);
      let {capabilities} = perms;
      if (!capabilities.has(policyType)) {
        let temp = sender.tab.incognito; // we don't want to store in PBM
        perms = new Permissions(new Set(capabilities), temp);
        perms.capabilities.add(policyType);
        /* TODO: handle contextual permissions
        if (contextUrl) {
          let context = Sites.optimalKey(contextUrl);
          let contextualSites = new Sites([[context, perms]]);
          perms = new Permissions(new Set(capabilities), false, contextualSites);
        }
        */
        ns.policy.set(key, perms);
        await ns.savePolicy();
      }
      return {enable: key};
    },
  }
  const Content = {
    async reportTo(request, allowed, policyType) {
      let {requestId, tabId, frameId, type, url, documentUrl, originUrl} = request;
      let pending = pendingRequests.get(requestId); // null if from a CSP report
      let initialUrl = pending ? pending.initialUrl : request.url;
      request = {
          key: Policy.requestKey(url, type, documentUrl || "", /^(media|object|frame)$/.test(type)),
          type, url, documentUrl, originUrl
      };
      if (tabId < 0) {
        if ((policyType === "script" || policyType === "fetch") &&
              url.startsWith("https://") && documentUrl && documentUrl.startsWith("https://")) {
          // service worker request ?
          let payload = {request, allowed, policyType, serviceWorker: Sites.origin(documentUrl)};
          let recipient = {frameId: 0};
          for (let tabId of TabStatus.findTabsByOrigin(payload.serviceWorker)) {
            recipient.tabId = tabId;
            try {
              Messages.send("seen", payload, recipient);
            } catch (e) {
              // likely a privileged tab where our content script couldn't run
            }
          }
        }
        return;
      }
      if (pending) request.initialUrl = pending.initialUrl;
      if (type !== "sub_frame") { // we couldn't deliver it to frameId, since it's generally not loaded yet
        try {
          await Messages.send("seen",
            {request, allowed, policyType, ownFrame: true},
            {tabId, frameId}
          );
        } catch (e) {
          debug(`Couldn't deliver "seen" message for ${type}@${url} ${allowed ? "A" : "F" } to document ${documentUrl} (${frameId}/${tabId})`, e);
        }
      }
      if (frameId === 0) return;
      try {
        await Messages.send("seen",
          {request, allowed, policyType},
          {tabId, frameId: 0}
        );
      } catch (e) {
        debug(`Couldn't deliver "seen" message to top frame containing ${documentUrl} (${frameId}/${tabId}`, e);
      }
    }
  };
  const pendingRequests = new Map();
  function initPendingRequest(request) {
    let {requestId, url} = request;
    let redirected = pendingRequests.get(requestId);
    let initialUrl = redirected ? redirected.initialUrl : url;
    pendingRequests.set(requestId, {
      initialUrl, url, redirected,
      onCompleted: new Set(),
    });
    return redirected;
  }

  let normalizeRequest = request => {

    function fakeOriginFromTab({tabId, type} = request) {
      if (type !== "main_frame") {
        let tab = tabId !== -1 && TabCache.get(tabId);
        if (tab) {
          return request.initiator = request.originUrl = request.documentUrl = tab.url;
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

  function intersectCapabilities(perms, request) {
    let {frameId, frameAncestors, tabId} = request;
    if (frameId !== 0 && ns.sync.cascadeRestrictions) {
      let topUrl = frameAncestors && frameAncestors.length
        && frameAncestors[frameAncestors.length - 1].url;
      if (!topUrl) {
        let tab = TabCache.get(tabId);
        if (tab) topUrl = tab.url;
      }
      if (topUrl) {
        return ns.policy.cascadeRestrictions(perms, topUrl).capabilities;
      }
    }
    return perms.capabilities;
  }

  const ABORT = {cancel: true}, ALLOW = {};
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
      debug("Recent requests garbage collection.");
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
    let {originUrl, url} = request;
    if (originUrl && !Sites.isInternal(originUrl) && url.startsWith("http") &&
      !ns.policy.can(originUrl, "lan", ns.policyContext(request))) {
      // we want to block any request whose origin resolves to at least one external WAN IP
      // and whose destination resolves to at least one LAN IP
      let {proxyInfo} = request; // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/ProxyInfo
      let neverDNS = (proxyInfo && (proxyInfo.type && proxyInfo.type.startsWith("http") || proxyInfo.proxyDNS))
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

  const listeners = {
    onBeforeRequest(request) {
      try {
        if (browser.runtime.onSyncMessage && browser.runtime.onSyncMessage.isMessageRequest(request)) return ALLOW;
        normalizeRequest(request);
        initPendingRequest(request);

        let {policy} = ns
        let {tabId, type, url, originUrl} = request;

        if (type in policyTypesMap) {
          let previous = recent.find(request);
          if (previous) {
            debug("Rapid fire request", previous);
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
            if (tabId < 0 && documentUrl && documentUrl.startsWith("https:")) {
              allowed = [...ns.unrestrictedTabs]
                .some(tabId => TabStatus.hasOrigin(tabId, documentUrl));
            }
            if (!allowed) {
              let capabilities = intersectCapabilities(
                policy.get(url, ns.policyContext(request)).perms,
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
          if (type !== "main_frame") {
            Content.reportTo(request, allowed, policyType);
          }
          if (!allowed) {
            debug(`Blocking ${policyType}`, request);
            TabStatus.record(request, "blocked");
            return previous.return = ABORT;
          }
        }
      } catch (e) {
        error(e);
      }
      return ALLOW;
    },

    onBeforeSendHeaders(request) {
      normalizeRequest(request);
      let lanRes = checkLANRequest(request);
      if (!UA.isMozilla) return lanRes; // Chromium doesn't support async blocking suspension, stop here
      if (lanRes === ABORT) return ABORT;
      // redirection loop test
      let pending = pendingRequests.get(request.requestId);
      if (pending && pending.redirected && pending.redirected.url === request.url) {
        return lanRes; // don't go on stripping cookies if we're in a redirection loop
      }
      let chainNext = r => r === ABORT ? r : TabGuard.check(request);
      return lanRes instanceof Promise ? lanRes.then(chainNext) : chainNext(lanRes);
    },

    onHeadersReceived(request) {
      // called for main_frame, sub_frame and object

      // check for duplicate calls
      let pending = pendingRequests.get(request.requestId);
      if (pending) {
        if (pending.headersProcessed) {
          if (!request.fromCache) {
            debug("Headers already processed, skipping ", request);
            return ALLOW;
          }
          debug("Reprocessing headers for cached request ", request);
        } else {
          debug("onHeadersReceived", request);
        }
      } else {
        debug("[WARNING] no pending information for ", request);
        initPendingRequest(request);
        pending = pendingRequests.get(request.requestId);
      }
      if (request.fromCache && listeners.onHeadersReceived.resetCSP && !pending.resetCachedCSP) {
        debug("Resetting CSP Headers");
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
          debug("Resetting cached NoScript CSP header(s)", request);
          return {responseHeaders};
        }
      }

      normalizeRequest(request);
      let result = ALLOW;
      let promises = [];
      let headersModified = false;

      pending.headersProcessed = true;
      let {url, documentUrl, tabId, responseHeaders, type} = request;
      let isMainFrame = type === "main_frame";
      try {
        let capabilities;
        if (ns.isEnforced(tabId)) {
          let policy = ns.policy;
          let {perms} = policy.get(url, ns.policyContext(request));
          if (isMainFrame) {
            if (policy.autoAllowTop && perms === policy.DEFAULT) {
              policy.set(Sites.optimalKey(url), perms = policy.TRUSTED.tempTwin);
            }
            capabilities = perms.capabilities;
          } else {
            capabilities = intersectCapabilities(perms, request);
          }
        } // else unrestricted, either globally or per-tab
        if (isMainFrame && !TabStatus.map.has(tabId)) {
          debug("No TabStatus data yet for noscriptFrame", tabId);
          TabStatus.record(request, "noscriptFrame",
            capabilities && !capabilities.has("script"));
        }
        let header = csp.patchHeaders(responseHeaders, capabilities);
        /*
        // Uncomment me to disable networking-level CSP for debugging purposes
        header = null;
        */
        if (header) {
          pending.cspHeader = header;
          debug(`CSP blocker on %s:`, url, header.value);
          headersModified = true;
        }
        if (headersModified) {
          result = {responseHeaders};
          debug("Headers changed ", request);
        }
      } catch (e) {
        error(e, "Error in onHeadersReceived", request);
      }

      promises = promises.filter(p => p instanceof Promise);
      if (promises.length > 0) {
        return Promise.all(promises).then(() => result);
      }

      return result;
    },
    onResponseStarted(request) {
      normalizeRequest(request);
      debug("onResponseStarted", request);
      let {requestId, url, tabId, frameId, type} = request;
      if (type === "main_frame") {
        TabStatus.initTab(tabId);
        TabGuard.postCheck(request);
      }
      let scriptBlocked = request.responseHeaders.some(
        h => csp.isMine(h) && csp.blocks(h.value, "script")
      );
      debug("%s scriptBlocked=%s setting noscriptFrame on ", url, scriptBlocked, tabId, frameId);
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
      TabGuard.postCheck(request);
    },
    onErrorOccurred(request) {
      pendingRequests.delete(request.requestId);
      TabGuard.postCheck(request);
    }
  };
  function fakeRequestFromCSP(report, request) {
    let type = report["violated-directive"].split("-", 1)[0]; // e.g. script-src 'none' => script
    if (type === "frame") type = "sub_frame";
    let url = report['blocked-uri'];
    if (!url || url === 'self') url = request.documentUrl;
    return Object.assign({}, request, {
      url,
      type,
    });
  }

  let utf8Decoder = new TextDecoder("UTF-8");
  function onViolationReport(request) {
    try {
      let text = utf8Decoder.decode(request.requestBody.raw[0].bytes);
      if (text.includes(`"inline"`)) return ABORT;
      let report = JSON.parse(text)["csp-report"];
      let originalPolicy = report["original-policy"]
      debug("CSP report", report);
      let blockedURI = report['blocked-uri'];
      if (blockedURI && blockedURI !== 'self') {
        let r = fakeRequestFromCSP(report, request);
        if (!/:/.test(r.url)) r.url = request.documentUrl;
        Content.reportTo(r, false, policyTypesMap[r.type]);
        TabStatus.record(r, "blocked");
      } else if (report["violated-directive"].startsWith("script-src") && (originalPolicy.includes("script-src 'none'"))) {
        let r =  fakeRequestFromCSP(report, request);
        Content.reportTo(r, false, "script"); // NEW
        TabStatus.record(r, "noscriptFrame", true);
      }
    } catch(e) {
      error(e);
    }
    return ABORT;
  }

  function injectPolicyScript(details) {
    let {url, tabId, frameId} = details;
    let policy = ns.computeChildPolicy({url}, {tab: {id: tabId}, frameId});
    policy.navigationURL = url;
    let debugStatement = ns.local.debug ? `
      let mark = Date.now() + ":" + Math.random();
      console.debug("domPolicy", domPolicy, document.readyState, location.href, mark, window.ns);` : '';
    return `
      let domPolicy = ${JSON.stringify(policy)};
      let {ns} = window;
      if (ns) {
        ns.domPolicy = domPolicy;
        if (ns.setup) {
          if (ns.syncSetup) ns.syncSetup(domPolicy);
          else ns.setup(domPolicy);
        } ;
      } else {
        window.ns = {domPolicy}
      }
      ${debugStatement}`;
  }

  const RequestGuard = {
    async start() {
      Messages.addHandler(messageHandler);
      let wr = browser.webRequest;
      let listen = (what, ...args) => wr[what].addListener(listeners[what], ...args);
      let allUrls = ["<all_urls>"];
      let docTypes = ["main_frame", "sub_frame", "object"];
      let filterDocs = {urls: allUrls, types: docTypes};
      let filterAll = {urls: allUrls};
      listen("onBeforeRequest", filterAll, ["blocking"]);
      listen("onBeforeSendHeaders", filterAll, ["blocking",  "requestHeaders"]);

      let mergingCSP = "getBrowserInfo" in browser.runtime;
      if (mergingCSP) {
        let {vendor, version} = await browser.runtime.getBrowserInfo();
        mergingCSP = vendor === "Mozilla" && parseInt(version) >= 77;
      }
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
        let {requestId, responseHeaders} = request;
        let pending = pendingRequests.get(request.requestId);
        if (pending && pending.headersProcessed) {
          let {cspHeader} = pending;
          if (cspHeader) {
            responseHeaders.push(cspHeader);
            return {responseHeaders};
          }
        } else {
          debug("[WARNING] onHeadersReceived not called (yet?)", request);
        }
        return ALLOW;
      }, filterDocs, ["blocking", "responseHeaders"])).install();

      listen("onResponseStarted", filterDocs, ["responseHeaders"]);
      listen("onCompleted", filterAll);
      listen("onErrorOccurred", filterAll);
      if (csp.reportURI) {
        wr.onBeforeRequest.addListener(onViolationReport,
          {urls: [csp.reportURI], types: ["csp_report"]}, ["blocking", "requestBody"]);
      }
      DocStartInjection.register(injectPolicyScript);
      TabStatus.probe();
    },
    stop() {
      let wr = browser.webRequest;
      for (let [name, listener] of Object.entries(listeners)) {
        if (typeof listener === "function") {
          wr[name].removeListener(listener);
        } else if (listener instanceof LastListener) {
          listener.uninstall();
        }
      }
      wr.onBeforeRequest.removeListener(onViolationReport);
      if (listeners.onHeadersReceived.resetCSP) {
        wr.onHeadersReceived.removeListener(listeners.onHeadersReceived.resetCSP);
      }
      DocStartInjection.unregister(injectPolicyScript);
      Messages.removeHandler(messageHandler);
    }
  };
  return RequestGuard;
})();
