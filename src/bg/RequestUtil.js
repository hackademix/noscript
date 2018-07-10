'use strict';
{
  let NULL = new Uint8Array();
  let DEFAULT_CHARSET = "utf-8";
  let xmlFeedOrImage = /^(?:(?:application|text)\/(?:(?:r(?:ss|df)|atom)\+)xml(;|$))|image\//i;
  let rawXml = /^(?:application|text)\/xml;/i;
  let brokenOnLoad;

  let pendingRequests = new Map();

  let reloadingTabs = new Set();
  let tabKey = (tabId, url) => `${tabId}:${url}`;

  let cleanup = r => {
    pendingRequests.delete(r.requestId);
  };
  let filter = {
    urls: ["<all_urls>"],
    types:  ["main_frame", "sub_frame", "object"]
  };


  browser.webRequest.onCompleted.addListener(r => {
    cleanup(r);
    let {tabId, url} = r;
    let key = tabKey(tabId, url);
    if (reloadingTabs.has(key)) {
      debug("Reloading tab", key);
      browser.tabs.update(tabId, {url});
    }
  }, filter);
  browser.webRequest.onErrorOccurred.addListener(cleanup, filter);

  let executeAll = async (scripts, where) => {
    let {url, tabId, frameId} = where;

    let count = 0;
    for (let details of scripts.values()) {
      details = Object.assign({
        runAt: "document_start",
        matchAboutBlank: true,
        frameId,
      }, details);
      try {
        await browser.tabs.executeScript(tabId, details);
        count++;
        debug("Execute on start OK", url, details);
      } catch (e) {
        error(e, "Execute on start failed", url, details);
      }
    }
    return count;
  };

  var RequestUtil = {

    getContentMetaData(request) {
      return request.content || (request.content = new ContentMetaData(request));
    },

    async executeOnStart(request, details) {
      let {requestId, url, tabId, frameId, statusCode} = request;

      if (statusCode >= 300 && statusCode < 400) return;
      let scripts = pendingRequests.get(requestId);
      let scriptKey = JSON.stringify(details);
      if (!scripts) {
        pendingRequests.set(requestId, scripts = new Map());
        scripts.set(scriptKey, details);
      } else {
        scripts.set(scriptKey, details);
        return;
      }

      if (frameId === 0) {
        let key = tabKey(tabId, url);
        debug("Checking whether %s is a reloading tab...", key);
        if (reloadingTabs.has(key)) {
          debug("Skipping dynamic script injection for reloading feed tab", key);
          let filter = browser.webRequest.filterResponseData(requestId);
          filter.onstart = e => {
            reloadingTabs.delete(key);
            filter.write(NULL);
            filter.disconnect();
          }
          return;
        }
      }

      let content = this.getContentMetaData(request);
      debug(url, content.type, content.charset);
      if (xmlFeedOrImage.test(content.type) && !/\/svg\b/i.test(content.type)) return;
      if (typeof brokenOnLoad === "undefined") {
        brokenOnLoad = await (async () => parseInt((await browser.runtime.getBrowserInfo()).version) < 61)();
      }

      let mustCheckFeed = brokenOnLoad && frameId === 0 && rawXml.test(content.type);
      debug("mustCheckFeed = %s, brokenOnLoad = %s", mustCheckFeed, brokenOnLoad);
      let filter = browser.webRequest.filterResponseData(requestId);
      let buffer = [];
      let first = true;
      let runAndFlush = async () => {
        let scriptsRan = await executeAll(scripts, request);
        if (mustCheckFeed && !scriptsRan) {
          debug(`Marking as "must reload"`, tabId, url);
          reloadingTabs.add(tabKey(tabId, url));
        }
        if (buffer && buffer.length) {
          debug("Flushing %s buffer chunks", buffer.length);
          for (let chunk of buffer) {
            filter.write(chunk);
          }
          filter.disconnect();
          buffer = null;
        }
      };

      if (brokenOnLoad) {
        filter.onstart = event => {
          filter.write(NULL);
          debug("onstart", url);
        }
      }

      filter.ondata = event => {
        if (first) {
          runAndFlush();
          first = false;
        }
        if (buffer) {
          buffer.push(event.data);
          return;
        }

        debug("ondata", url);
        filter.write(event.data);
        filter.disconnect();
      };


    }
  }
}
