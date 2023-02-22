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

'use strict';

var XSS = (() => {

  const ABORT = {cancel: true}, ALLOW = {};

  let baseTTL = 20000; // timeout in milliseconds for each worker to perform

  let workersMap = new Map();
  let promptsMap = new Map();
  let blockedTabs = new Map();

  let requestIdCount = 0;

  async function getUserResponse(xssReq) {
    let {originKey, request} = xssReq;
    let {tabId, frameId} = request;
    let {browserAction} = browser;
    if (frameId === 0) {
      if (blockedTabs.has(tabId)) {
        blockedTabs.delete(tabId);
        if ("setBadgeText" in browserAction) {
          browserAction.setBadgeText({tabId, text: ""});
        }
      }
    }
    await promptsMap.get(originKey);

    switch (await XSS.getUserChoice(originKey)) {
      case "allow":
        return ALLOW;
      case "block":
        log("Blocking request from %s to %s by previous XSS prompt user choice",
        xssReq.srcUrl, xssReq.destUrl);

        if ("setBadgeText" in browserAction) {
          browserAction.setBadgeText({tabId, text: "XSS"});
          browserAction.setBadgeBackgroundColor({tabId, color: [128, 0, 0, 160]});
        }
        let keys = blockedTabs.get(tabId);
        if (!keys) blockedTabs.set(tabId, keys = new Set());
        keys.add(originKey);
        return ABORT;
    }
    return null;
  }

  function doneListener(request) {
    let {requestId} = request;
    let worker = workersMap.get(requestId);
    if (worker) {
      worker.terminate();
      workersMap.delete(requestId);
    }
  }

  async function requestListener(request) {

    {
      let {type} = request;
      if (type !== "main_frame") {
        if (type === "sub_frame") type = "frame";
        if (!ns.requestCan(request, type)) {
          return ALLOW; // it will be blocked by RequestGuard
        }
      }
    }
    let xssReq = XSS.parseRequest(request);
    if (!xssReq) return null;
    let userResponse = await getUserResponse(xssReq);
    if (userResponse) return userResponse;

    let data;
    let reasons;

    try {

      reasons = await XSS.maybe(xssReq);
      if (!reasons) return ALLOW;

      data = [];
    } catch (e) {
      error(e, "XSS filter processing %o", xssReq);
      if (/^Timing:[^]*\binterrupted\b/.test(e.message)) {
        // we don't want prompts if the request expired / errored first
        return ABORT;
      }
      reasons = { urlInjection: true };
      data = [e.toString()];
    }


    let prompting = (async () => {
      userResponse = await getUserResponse(xssReq);
      if (userResponse) return userResponse;

      let {srcOrigin, destOrigin, unescapedDest} = xssReq;
      let block = !!(reasons.urlInjection || reasons.postInjection)

      if (reasons.protectName) {
        await include("/nscl/service/ContentScriptOnce.js");
        try {
          await ContentScriptOnce.execute(request, {
            js: [{file: "/xss/sanitizeName.js"}],
          });
          if (!block) return ALLOW;
        } catch (e) {
          error(e, "Sanitizing name in request", request.url);
        }
      }
      if (reasons.urlInjection) data.push(`(URL) ${unescapedDest}`);
      if (reasons.postInjection) data.push(`(POST) ${reasons.postInjection}`);

      let source = srcOrigin && srcOrigin !== "null" ? srcOrigin : "[...]";

      let {button, option} = await Prompts.prompt({
        title: _("XSS_promptTitle"),
        message: _("XSS_promptMessage", [source, destOrigin, data.join(",")]),
        options: [
          {label: _(`XSS_opt${block ? 'Block' : 'Sanitize'}`), checked: true}, // 0
          {label: _("XSS_optAlwaysBlock", [source, destOrigin])}, // 1
          {label: _("XSS_optAllow")}, // 2
          {label: _("XSS_optAlwaysAllow", [source, destOrigin])}, // 3
        ],

        buttons: [_("Ok")],
        multiple: "focus",
        width: 600,
        height: 480,
      });

      if (button === 0 && option >= 2) {
        if (option === 3) { // always allow
          await XSS.setUserChoice(xssReq.originKey, "allow");
          await XSS.saveUserChoices();
        }
        return ALLOW;
      }
      if (option === 1) { // always block
        block = true;
        await XSS.setUserChoice(xssReq.originKey, "block");
        await XSS.saveUserChoices();
      }
      return block ? ABORT : ALLOW;
    })();
    promptsMap.set(xssReq.originKey, prompting);
    try {
      return await prompting;
    } catch (e) {
      error(e);
      return ABORT;
    }
  };

  function parseUrl(url) {
    let u = new URL(url);
    // make it cloneable
    return {
      href: u.href,
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      origin: u.origin,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
    };
  }

  return {
    async start() {
      if (!UA.isMozilla) return; // async webRequest is supported on Mozilla only

      let {onBeforeRequest, onCompleted, onErrorOccurred} = browser.webRequest;

      if (onBeforeRequest.hasListener(requestListener)) return;

      await include("/legacy/Legacy.js");
      await include("/xss/Exceptions.js");

      this._userChoices = (await Storage.get("sync", "xssUserChoices")).xssUserChoices || {};

      // convert old style whitelist if stored
      let oldWhitelist = await XSS.Exceptions.getWhitelist();
      if (oldWhitelist) {
        for (let [destOrigin, sources] of Object.entries(oldWhitelist)) {
          for (let srcOrigin of sources) {
            this._userChoices[`${srcOrigin}>${destOrigin}`] = "allow";
          }
        }
        XSS.Exceptions.setWhitelist(null);
      }
      let filter = {
        urls: ["*://*/*"],
        types: ["main_frame", "sub_frame", "object"]
      };
      onBeforeRequest.addListener(requestListener, filter, ["blocking", "requestBody"]);
      if (!onCompleted.hasListener(doneListener)) {
        onCompleted.addListener(doneListener, filter);
        onErrorOccurred.addListener(doneListener, filter);
      }
    },

    stop() {
      let {onBeforeRequest} = browser.webRequest;
      if (onBeforeRequest.hasListener(requestListener)) {
        onBeforeRequest.removeListener(requestListener);
      }
    },

    parseRequest(request) {
      let {
        url: destUrl,
        originUrl: srcUrl,
        method
      } = request;
      let destObj;
      try {
        destObj = parseUrl(destUrl);
      } catch (e) {
        error(e, "Cannot create URL object for %s", destUrl);
        return null;
      }
      let srcObj = null;
      if (srcUrl) {
        try {
          srcObj = parseUrl(srcUrl);
        } catch (e) {}
      } else {
        srcUrl = "";
      }

      let unescapedDest = unescape(destUrl);
      let srcOrigin = srcObj ? srcObj.origin : "";
      if (srcOrigin === "null") {
        srcOrigin = srcObj.href.replace(/[\?#].*/, '');
      }
      let destOrigin = destObj.origin;

      let isGet = method === "GET";
      return {
        request,
        srcUrl,
        destUrl,
        srcObj,
        destObj,
        srcOrigin,
        destOrigin,
        srcDomain: srcObj && srcObj.hostname && tld.getDomain(srcObj.hostname) || "",
        destDomain: tld.getDomain(destObj.hostname),
        originKey: `${srcOrigin}>${destOrigin}`,
        unescapedDest,
        isGet,
        isPost: !isGet && method === "POST",
        timestamp: Date.now(),
        debugging: ns.local.debug,
      }
    },

    async saveUserChoices(xssUserChoices = this._userChoices || {}) {
      this._userChoices = xssUserChoices;
      await Storage.set("sync", {xssUserChoices});
    },
    getUserChoices() {
      return this._userChoices;
    },
    setUserChoice(originKey, choice) {
      this._userChoices[originKey] = choice;
    },
    getUserChoice(originKey) {
      return this._userChoices[originKey];
    },

    getBlockedInTab(tabId) {
      return blockedTabs.has(tabId) ? [...blockedTabs.get(tabId)] : null;
    },

    async maybe(xssReq) { // return reason or null if everything seems fine
      if (await this.Exceptions.shouldIgnore(xssReq)) {
        return null;
      }

      let skip = this.Exceptions.partial(xssReq);
      let worker = new Worker(browser.runtime.getURL("/xss/InjectionCheckWorker.js"));
      let {requestId} = xssReq.request;
      workersMap.set(requestId, worker)
      return await new Promise((resolve, reject) => {
        worker.onmessage = e => {
          let {data} = e;
          if (data) {
            if (data.logType) {
              window[data.logType](...data.log);
              return;
            }
            if (data.error) {
              cleanup();
              reject(data.error);
              return;
            }
          }
          cleanup();
          resolve(e.data);
        }
        worker.onerror = worker.onmessageerror = e => {
          cleanup();
          reject(e);
        }
        worker.postMessage({handler: "check", xssReq, skip});

        let onNavError = details => {
          debug("Navigation error: %o", details);
          let {tabId, frameId, url} = details;
          let r = xssReq.request;
          if (tabId === r.tabId && frameId === r.frameId) {
            cleanup();
            reject(new Error("Timing: request interrupted while being filtered, no need to go on."));
          }
        };
        browser.webNavigation.onErrorOccurred.addListener(onNavError,
          {url: [{urlEquals: xssReq.destUrl}]});

        let startTime = Date.now(), elapsed = 0, dosTimeout;
        let ttlCheck = async () => {
          let workersCount = workersMap.size;
          if (workersCount < 1) return;

          let userResponse = await getUserResponse(xssReq);
          if (userResponse) return resolve(userResponse);

          let now = Date.now();
          elapsed += (now - startTime) / workersCount; // divide to take in account concurrency overhead
          if (elapsed < baseTTL) {
            startTime = now;
            dosTimeout = setTimeout(ttlCheck, 2000);
            return;
          }
          if (cleanup()) { // the request might have been aborted otherwise
            reject(new Error("Timeout! DOS attack attempt?"));
          } else {
            debug("[XSS] Request %s already aborted while being filtered.",
              xssReq.destUrl);
          }
        };

        ttlCheck();

        function cleanup() {
          clearTimeout(dosTimeout);
          browser.webNavigation.onErrorOccurred.removeListener(onNavError);
          if (workersMap.has(requestId)) {
            workersMap.delete(requestId);
            worker.terminate();
            return true;
          }
          return false;
        };
      });
    },

    async test(urlOrRequest) {
      let r = {
        requestId: `fake${requestIdCount++}`,
        originUrl: '',
        method: "GET",
      };
      if (typeof urlOrRequest === "string") {
        r.url = urlOrRequest;
      } else if (typeof urlOrRequest === "object") {
        Object.assign(r, urlOrRequest);
      }
      return await XSS.maybe(XSS.parseRequest(r));
    }
  };
})();
