'use strict';
{
  let xmlFeedOrImage = /^(?:(?:application|text)\/(?:(?:r(?:ss|df)|atom)\+)xml(;|$))|image\//i;
  let rawXml = /^(?:application|text)\/xml;/i;
  let brokenXMLOnLoad;

  let pendingRequests = new Map();

  let reloadingTabs = new Map();
  let tabKey = (tabId, url) => `${tabId}:${url}`;

  let cleanup = r => {
    pendingRequests.delete(r.requestId);
    let key = tabKey(r.tabId, r.url);
    if (reloadingTabs.get(key) === false) {
      reloadingTabs.delete(key);
    }
  };
  
  let executeAll = async request => {
    let {url, tabId, frameId, requestId} = request;
    let scripts = pendingRequests.get(requestId);
    if (!scripts) return -1;
    pendingRequests.delete(requestId);
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
  
  {
    let filter = {
      urls: ["<all_urls>"],
      types:  ["main_frame", "sub_frame", "object"]
    };
    let wr = browser.webRequest;
    for (let event of ["onCompleted", "onErrorOccurred"])
      wr[event].addListener(cleanup, filter);
  
    filter.types = ["main_frame"];
    wr.onResponseStarted.addListener(executeAll, filter);
  }
  
  var RequestUtil = {

    getResponseMetaData(request) {
      return request.response || (request.response = new ResponseMetaData(request));
    },

    async executeOnStart(request, details) {
      let {requestId, url, tabId, frameId, statusCode} = request;

      if (statusCode >= 300 && statusCode < 400) return;
      if (frameId === 0) {
        let key = tabKey(tabId, url);
        debug("Checking whether %s is a reloading tab...", key);
        if (reloadingTabs.get(key)) {
          reloadingTabs.set(key, false); // doom it for removal in cleanup
          return;
        }
      }
      
      let response = this.getResponseMetaData(request);
      let {contentType, contentDisposition} = response;
      if (contentDisposition ||
          xmlFeedOrImage.test(contentType) && !/\/svg\b/i.test(contentType)) {
        debug("Skipping execute on start of %s %o.", url, response);
        return;
      }
      
      debug("Injecting script on start in %s (%o).", url, response);

      let scripts = pendingRequests.get(requestId);
      let scriptKey = JSON.stringify(details);
      if (!scripts) {
        pendingRequests.set(requestId, scripts = new Map());
        scripts.set(scriptKey, details);
      } else {
        scripts.set(scriptKey, details);
        return;
      }
      
      if (request.type === "main_frame" 
          && /^(?:application|text)\//.test(contentType) 
          && !/[^;]+\b(html|xml)\b/i.test(contentType)) {
        debug("Not HTML, but top-level document: defer script to onResponseStarted for %s (%o)", url, response);
        return;
      }
      
      if (typeof brokenXMLOnLoad === "undefined") {
        brokenXMLOnLoad = await (async () => parseInt((await browser.runtime.getBrowserInfo()).version) < 61)();
      }
      
      let mustCheckFeed = brokenXMLOnLoad && frameId === 0 && rawXml.test(contentType);
      debug("mustCheckFeed = %s, brokenXMLOnLoad = %s", mustCheckFeed, brokenXMLOnLoad);
      let filter = browser.webRequest.filterResponseData(requestId);
      let buffer = [];
      let first = true;
      let done = false;
      let mustReload = false;
      let runAndFlush = async () => {
        let scriptsRan = await executeAll(request);
        if (mustCheckFeed && !scriptsRan) {
          mustReload = true;
          debug(`Marking as "must reload"`, tabId, url);
          reloadingTabs.set(tabKey(tabId, url), true);
        }
        if (buffer && buffer.length) {
          debug("Flushing %s buffer chunks", buffer.length);
          for (let chunk of buffer) {
            filter.write(chunk);
          }
          filter.disconnect();
          buffer = null;
        }
        if (done) {
          filter.onstop(null);
        }
      };

      filter.ondata = event => {
        if (first) {
          runAndFlush();
          first = false;
        }
        if (buffer) {
          debug("buffering", url);
          buffer.push(event.data);
          return;
        }

        debug("ondata", url);
        filter.write(event.data);
        filter.disconnect();
      };

      filter.onstop = event => {
        done = true;
        if (mustReload && !buffer) {
          mustReload = false;
          browser.tabs.update(tabId, {url});
        }
      }
    }
  }
}
