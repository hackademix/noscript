'use strict';
{
  let xmlFeedOrImage = /^(?:(?:application|text)\/(?:(?:r(?:ss|df)|atom)\+)xml(;|$))|image\//i;
  let rawXml = /^(?:application|text)\/xml;/i;
  let brokenXMLOnLoad;
  (async () => brokenXMLOnLoad = parseInt((await browser.runtime.getBrowserInfo()).version) < 61)()
  
  let pendingScripts = new Map();
  let NOP = () => {};
  
  let reloadingTabs = new Map();
  let tabKey = (tabId, url) => `${tabId}:${url}`;

  let cleanup = r => {
    pendingScripts.delete(r.requestId);
    let key = tabKey(r.tabId, r.url);
    if (reloadingTabs.get(key) === false) {
      reloadingTabs.delete(key);
    }
  };
  
  let executeAll = async request => {
    let {url, tabId, frameId, requestId, type} = request;
    let scripts = pendingScripts.get(requestId);
    if (!scripts) return -1;
    pendingScripts.delete(requestId);
    
    let where = type === "object" ? {allFrames: true} : {frameId};
    let count = 0;
    let run = async details => {
      details = Object.assign({
        runAt: "document_start",
        matchAboutBlank: true,
      }, details, where);
      try {
        let res;
        for (let attempts = 10; attempts-- > 0;) {
          try {
            res = await browser.tabs.executeScript(tabId, details);
            break;
          } catch(e) {
            if (!/No matching message handler/.test(e.message)) throw e;
            debug("Couldn't inject script into %s: too early? Retrying up to %s times...", url, attempts);
          }
        }
        count++;
        debug("Execute on start OK, result=%o", res, url, details);
      } catch (e) {
        error(e, "Execute on start failed", url, details);
      }
    };

    await run({code: `void(window.correctFrame = () => "${url}" === document.URL && document.readyState === "loading")`});
    await Promise.all([...scripts.values()].map(run));
    await run({code: `void(window.correctFrame = () => false)`});
    return count;
  };
  
  {
    let filter = {
      urls: ["<all_urls>"],
      types:  ["main_frame", "sub_frame", "object"]
    };
    let wr = browser.webRequest;
    for (let event of ["onCompleted", "onErrorOccurred"]) {
      wr[event].addListener(cleanup, filter);
    }
    
    wr.onResponseStarted.addListener(r => {
      let scripts = pendingScripts.get(r.requestId);
      if (scripts) scripts.runAndFlush();
    }, filter);
  }
  
  var RequestUtil = {

    getResponseMetaData(request) {
      return request.response || (request.response = new ResponseMetaData(request));
    },

    executeOnStart(request, details) {
      let {requestId, url, tabId, frameId, statusCode, type} = request;

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

      let scripts = pendingScripts.get(requestId);
      let scriptKey = JSON.stringify(details);
      if (!scripts) {
        pendingScripts.set(requestId, scripts = new Map());
        scripts.set(scriptKey, details);
      } else {
        scripts.set(scriptKey, details);
        return;
      }
      
      if (/^(?:application|text)\//.test(contentType) 
          && !/[^;]+\b(html|xml)\b/i.test(contentType)) {
        debug("Not HTML: defer script to onResponseStarted for %s (%o)", url, response);
        return;
      }
      
      let mustCheckFeed = brokenXMLOnLoad && frameId === 0 && rawXml.test(contentType);
      debug("mustCheckFeed = %s, brokenXMLOnLoad = %s", mustCheckFeed, brokenXMLOnLoad);
      let filter = browser.webRequest.filterResponseData(requestId);
      let buffer = [];
      let responseCompleted = false;
      let mustReload = false;
      scripts.runAndFlush = async () => {
        scripts.runAndFlush = NOP;
        if (responseCompleted && buffer && !buffer.length) {
          filter.disconnect();
        }
        let scriptsRan = await executeAll(request);
        if (mustCheckFeed && !scriptsRan) {
          mustReload = true;
          debug(`Marking as "must reload"`, tabId, url);
          reloadingTabs.set(tabKey(tabId, url), true);
        }
        if (buffer && buffer.length) {
          debug("Flushing %s buffer chunks on %s", buffer.length, url);
          for (let chunk of buffer) {
            filter.write(chunk);
          }
          buffer = null;
        }
        filter.disconnect();
        if (responseCompleted) {
          filter.onstop(null);
        }
      };
      
      filter.ondata = event => {
        scripts.runAndFlush();
        if (buffer) {
          debug("buffering", url);
          buffer.push(event.data);
          return;
        }

        debug("ondata", url);
        filter.write(event.data);
        filter.disconnect();
      };

      filter.onstop = async event => {
        responseCompleted = true;
        await scripts.runAndFlush();
        if (mustReload && !buffer) {
          mustReload = false;
          browser.tabs.update(tabId, {url});
        }
      }
    }
  }
}
