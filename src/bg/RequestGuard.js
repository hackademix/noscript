var RequestGuard = (() => {
  'use strict';
  const VERSION_LABEL =  `NoScript ${browser.runtime.getManifest().version}`;
  browser.browserAction.setTitle({title: VERSION_LABEL});
  const REPORT_URI = "https://noscript-csp.invalid/__NoScript_Probe__/";
  const REPORT_GROUP = "NoScript-Endpoint";
  let csp = new ReportingCSP(REPORT_URI, REPORT_GROUP);
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
  const allTypes = Object.keys(policyTypesMap);
  Object.assign(policyTypesMap, {"webgl": "webgl"}); // fake types
  const TabStatus = {
    map: new Map(),
    types: ["script", "object", "media", "frame", "font"],
    newRecords() {
      return {
        allowed: {},
        blocked: {},
        noscriptFrames: {},
      }
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
      let map = this.map;
      let records;
      if (map.has(tabId)) {
        records = map.get(tabId);
      } else {
        records = this.initTab(tabId);
      }
      if (what === "noscriptFrame" && type !== "object") {
        let nsf = records.noscriptFrames;
        nsf[frameId] = optValue;
        what = optValue ? "blocked" : "allowed";
        if (frameId === 0) {
          request.type = type = "main_frame";
          Content.reportTo(request, optValue, type);
        }
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
        let a = allowed[t] && allowed[t].length || 0, b = blocked[t] && blocked[t].length || 0, s = a + b;
        numAllowed+= a, numBlocked += b, sum += s;
        return s && `<${t === "sub_frame" ? "frame" : t}>: ${b}/${s}`;
      }).filter(s => s).join("\n");
      let enforced = ns.isEnforced(tabId);
      let icon = topAllowed ?
        (numBlocked ? "part"
          : enforced ? "yes" : "global")
        : (numAllowed ? "sub" : "no");
      let showBadge = ns.local.showCountBadge && numBlocked > 0;
      let browserAction = browser.browserAction;
      browserAction.setIcon({tabId, path: {64: `/img/ui-${icon}64.png`}});
      browserAction.setBadgeText({tabId, text: showBadge ? numBlocked.toString() : ""});
      browserAction.setBadgeBackgroundColor({tabId, color: [128, 0, 0, 160]});
      browserAction.setTitle({tabId,
        title: `${VERSION_LABEL} \n${enforced ?
            _("BlockedItems", [numBlocked, numAllowed + numBlocked]) + ` \n${report}`
            : _("NotEnforced")}`
      });
    },
    totalize(sum, value) {
      return sum + value;
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
    onRemovedTab(tabId) {
      TabStatus.map.delete(tabId);
    },
  }
  browser.tabs.onActivated.addListener(TabStatus.onActivatedTab);
  browser.tabs.onRemoved.addListener(TabStatus.onRemovedTab);
  if (!("setIcon" in browser.browserAction)) { // unsupported on Android
    TabStatus._updateTabNow = TabStatus.updateTab = () => {};
  }
  let messageHandler = {
    async pageshow(message, sender) {
      TabStatus.recordAll(sender.tab.id, message.seen);
      return true;
    },
    async enable(message, sender) {
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
        {label: _("allowLocal", origin)}
      ];
      let t = u => `${TAG}@${u}`;
      let ret = await Prompts.prompt({
        title: _("BlockedObjects"),
        message: _("allowLocal", TAG),
        options});
      debug(`Prompt returned %o`);
      if (ret.button !== 0) return;
      let key = [siteKey, origin][ret.option || 0];
      if (!key) return;
      let {siteMatch, contextMatch, perms} = ns.policy.get(key, documentUrl);
      let {capabilities} = perms;
      if (!capabilities.has(policyType)) {
        perms = new Permissions(new Set(capabilities), false);
        perms.capabilities.add(policyType);
        /* TODO: handle contextual permissions
        if (documentUrl) {
          let context = new URL(documentUrl).origin;
          let contextualSites = new Sites([context, perms]);
          perms = new Permissions(new Set(capabilities), false, contextualSites);
        }
        */
        ns.policy.set(key, perms);
        await ns.savePolicy();
      }
      return true;
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
      if (tabId < 0) return;
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
      url, redirected,
      onCompleted: new Set(),
    });
    return redirected;
  }
  const ABORT = {cancel: true}, ALLOW = {};
  const INTERNAL_SCHEME = /^(?:chrome|resource|moz-extension|about):/;
  const listeners = {
    onBeforeRequest(request) {
      try {
        let redirected = initPendingRequest(request);
        let {policy} = ns;
        let policyType = policyTypesMap[request.type];
        if (policyType) {
          let {url, originUrl, documentUrl} = request;
          if (("fetch" === policyType || "frame" === policyType) &&
              (((!originUrl || url === originUrl) && originUrl === documentUrl
                // some extensions make them both undefined,
                // see https://github.com/eight04/image-picka/issues/150
              ) ||
              INTERNAL_SCHEME.test(originUrl))
          ) {
            // livemark request or similar browser-internal, always allow;
            return ALLOW;
          }
          if (/^(?:data|blob):/.test(url)) {
            request._dataUrl = url;
            request.url = url = documentUrl;
          }
          let allowed = INTERNAL_SCHEME.test(url) ||
            !ns.isEnforced(request.tabId) ||
            policy.can(url, policyType, originUrl);
          Content.reportTo(request, allowed, policyType);
          if (!allowed) {
            debug(`Blocking ${policyType}`, request);
            TabStatus.record(request, "blocked");
            return ABORT;
          }
        }
      } catch (e) {
        error(e);
      }
      return ALLOW;
    },
    async onHeadersReceived(request) {
      // called for main_frame, sub_frame and object
      // check for duplicate calls
      let headersModified = false;
      let pending = pendingRequests.get(request.requestId);
      if (pending) {
        if (pending.headersProcessed) {
          debug("[WARNING] already processed ", request);
        } else {
          debug("onHeadersReceived", request);
        }
      } else {
        debug("[WARNING] no pending information for ", request);
        initPendingRequest(request);
        pending = pendingRequests.get(request.requestId);
      }
      pending.headersProcessed = true;
      let {url, documentUrl, statusCode, tabId, responseHeaders, type} = request;
      let isMainFrame = type === "main_frame";
      try {
        let capabilities;
        if (ns.isEnforced(tabId)) {
          let policy = ns.policy;
          let perms = policy.get(url, documentUrl).perms;
          if (policy.autoAllowTop && isMainFrame && perms === policy.DEFAULT) {
            policy.set(Sites.optimalKey(url), perms = policy.TRUSTED.tempTwin);
            await ChildPolicies.update(policy);
          }
          capabilities = perms.capabilities;
        } else {
          if (isMainFrame || type === "sub_frame") {
            let unrestricted = ns.unrestrictedTabs.has(tabId) && {unrestricted: true};
            if (unrestricted) {
              headersModified = ChildPolicies.addTabInfoCookie(request, unrestricted);
            }
          }
        }
        if (isMainFrame && !TabStatus.map.has(tabId)) {
          debug("No TabStatus data yet for noscriptFrame", tabId);
          TabStatus.record(request, "noscriptFrame",
            capabilities && !capabilities.has("script"));
        }
        let header = csp.patchHeaders(responseHeaders, capabilities);
        if (header) {
          pending.cspHeader = header;
          debug(`CSP blocker on %s:`, url, header.value);
          headersModified = true;
        }
        if (headersModified) {
          return {responseHeaders};
        }
      } catch (e) {
        error(e, "Error in onHeadersReceived", request);
      }
      return ALLOW;
    },
    onResponseStarted(request) {
      debug("onResponseStarted", request);
      let {requestId, url, tabId, frameId, type} = request;
      if (type === "main_frame") {
        TabStatus.initTab(tabId);
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
            (scriptBlocked || !ns.isEnforced(tabId) || ns.policy.can(url, "script", request.documentURL))
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
    },
    onErrorOccurred(request) {
      pendingRequests.delete(request.requestId);
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
  async function onViolationReport(request) {
    try {
      let decoder = new TextDecoder("UTF-8");
      const report = JSON.parse(decoder.decode(request.requestBody.raw[0].bytes))['csp-report'];
      let csp = report["original-policy"]
      debug("CSP report", report);
      let blockedURI = report['blocked-uri'];
      if (blockedURI && blockedURI !== 'self') {
        let r = fakeRequestFromCSP(report, request);
        if (r.url === 'inline') r.url = request.documentUrl;
        Content.reportTo(r, false, policyTypesMap[r.type]);
        TabStatus.record(r, "blocked");
      } else if (report["violated-directive"] === "script-src" && /; script-src 'none'/.test(report["original-policy"])) {
        let r =  fakeRequestFromCSP(report, request);
        Content.reportTo(r, false, "script"); // NEW
        TabStatus.record(r, "noscriptFrame", true);
      }
    } catch(e) {
      error(e);
    }
    return ABORT;
  }
  const RequestGuard = {
    async start() {
      Messages.addHandler(messageHandler);
      let wr = browser.webRequest;
      let listen = (what, ...args) => wr[what].addListener(listeners[what], ...args);
      let allUrls = ["<all_urls>"];
      let docTypes = ["main_frame", "sub_frame", "object"];
      let filterDocs = {urls: allUrls, types: docTypes};
      let filterAll = {urls: allUrls, types: allTypes};
      listen("onBeforeRequest", filterAll, ["blocking"]);
      listen("onHeadersReceived", filterDocs, ["blocking", "responseHeaders"]);
      (listeners.onHeadersReceivedLast = new LastListener(wr.onHeadersReceived, request => {
        let {requestId, responseHeaders} = request;
        let pending = pendingRequests.get(request.requestId);
        if (pending && pending.headersProcessed) {
          let {cspHeader} = pending;
          if (cspHeader) {
            debug("Safety net: injecting again %o in %o", cspHeader, request);
            for (let h of responseHeaders) {
              if (h.name === cspHeader.name) {
                h.value = cspHeader.value;
                cspHeader = null;
                break;
              }
            }
            if (cspHeader) responseHeaders.push(cspHeader);
            return {responseHeaders};
          }
        } else {
          debug("[WARNING] onHeadersReceived not called (yet?)", request);
        }
        return null;
      }, filterDocs, ["blocking", "responseHeaders"])).install();
      listen("onResponseStarted", filterDocs, ["responseHeaders"]);
      listen("onCompleted", filterAll);
      listen("onErrorOccurred", filterAll);
      wr.onBeforeRequest.addListener(onViolationReport,
        {urls: [csp.reportURI], types: ["csp_report"]}, ["blocking", "requestBody"]);
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
      Messages.removeHandler(messageHandler);
    }
  };
  return RequestGuard;
})();
