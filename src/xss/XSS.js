'use strict';

var XSS = (() => {

  const ABORT = {cancel: true}, ALLOW = {};

  let workersMap = new Map();
  let promptsMap = new Map();

  async function getUserResponse(xssReq) {
    let {originKey} = xssReq;
    await promptsMap.get(originKey);
    // promptsMap.delete(originKey);
    switch (await XSS.getUserChoice(originKey)) {
      case "allow":
        return ALLOW;
      case "block":
        log("Blocking request from %s to %s by previous XSS prompt user choice",
        xssReq.srcUrl, xssReq.destUrl);
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

    if (ns.isEnforced(request.tabId)) {
      let {policy} = ns;
      let {type} = request;
      if (type !== "main_frame") {
        if (type === "sub_frame") type = "frame";
        if (!policy.can(request.url, type, request.originUrl)) {
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
      if (/^Timing:/.test(e.message)  && !/\btimeout\b/i.test(e.message)) {
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
        await include("bg/ContentScriptOnce.js");
        await ContentScriptOnce.execute(request, {
          js: [{file: "/xss/sanitizeName.js"}],
        });
        if (!block) return ALLOW;
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

      // conver old style whitelist if stored
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
        unparsedRequest: request,
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

    async maybe(xssReq) { // return reason or null if everything seems fine
      if (await this.Exceptions.shouldIgnore(xssReq)) {
        return null;
      }

      let skip = this.Exceptions.partial(xssReq);
      let worker = new Worker(browser.runtime.getURL("/xss/InjectionCheckWorker.js"));
      let {requestId} = xssReq.unparsedRequest;
      workersMap.set(requestId, worker)
      return await new Promise((resolve, reject) => {
        let cleanup = () => {
          workersMap.delete(requestId);
          worker.terminate();
        };
        worker.onmessage = e => {
          let {data} = e;
          if (data) {
            if (data.logType) {
              window[data.logType](...data.log);
              return;
            }
            if (data.error) {
              reject(data.error);
              cleanup();
              return;
            }
          }
          resolve(e.data);
          cleanup();
        }
        worker.onerror = worker.onmessageerror = e => {
          reject(e);
          cleanup();
        }
        worker.postMessage({handler: "check", xssReq, skip});
        setTimeout(() => {
          reject(new Error("Timeout! DOS attack attempt?"));
          cleanup();
        }, 20000)
      });
    }
  };
})();
