'use strict';
{
  let NULL = new Uint8Array();
  let DEFAULT_CHARSET = "utf-8";
  let xmlFeedOrImage = /^(?:(?:application|text)\/(?:(?:r(?:ss|df)|atom)\+)xml(;|$))|image\//i;
  let rawXml = /^(?:application|text)\/xml;/i;
  let brokenOnLoad = (async () => parseInt(await browser.runtime.getBrowserInfo().version) < 61);

  let pendingRequests = new Map();

  let cleanup = r => {
    pendingRequests.delete(r.requestId);
  };
  let filter = {
    urls: ["<all_urls>"],
    types:  ["main_frame", "sub_frame", "object"]
  };
  browser.webRequest.onCompleted.addListener(cleanup, filter);
  browser.webRequest.onErrorOccurred.addListener(cleanup, filter);

  let executeAll = async (scripts, where) => {
    let {url, tabId, frameId} = where;
    for (let details of scripts.values()) {
      details = Object.assign({
        runAt: "document_start",
        matchAboutBlank: true,
        frameId,
      }, details);
      try {
        await browser.tabs.executeScript(tabId, details);
        debug("Execute on start OK", url, details);
      } catch (e) {
        error(e, "Execute on start failed", url, details);
      }
    }
  };

  var RequestUtil = {

    getContentMetaData(request) {
      return request.content || (request.content = new ContentMetaData(request));
    },

    async executeOnStart(request, details) {
      let {requestId, tabId, frameId, statusCode} = request;
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

      let content = this.getContentMetaData(request);
      debug(request.url, content.type, content.charset);
      if (xmlFeedOrImage.test(content.type) && !/\/svg\b/i.test(content.type)) return;
      let disconnect = !(brokenOnLoad && rawXml.test(content.type));
      let filter = browser.webRequest.filterResponseData(requestId);
      let buffer = [];

      let first = true;
      let runAndFlush = async () => {
        await executeAll(scripts, request);
        if (buffer.length) {
          debug("Flushing %s buffer chunks", buffer.length);
          for (let chunk of buffer) {
            filter.write(chunk);
          }
          if (disconnect) filter.disconnect();
          buffer = null;
        }
      };

      if (brokenOnLoad) {
        filter.onstart = event => {
          debug(`onstart ${request.url}`);
          filter.write(NULL);
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

        debug(`ondata ${request.url}`);
        filter.write(event.data);
        if (disconnect) filter.disconnect();
      };

    }
  }
}
