'use strict';
{
  let NULL = new Uint8Array();
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
      if (request.content) return request.content;
      let {responseHeaders} = request;
      let content = request.content = {};
      for (let h of responseHeaders) {
        if (/^\s*Content-(Type|Disposition)\s*$/i.test(h.name)) {
          content[h.name.split("-")[1].trim().toLowerCase()] = h.value;
        }
      }
      return content;
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
      debug(request.url, content.type);
      if (/^[\w/+-]*\b(xml|image)\b/i.test(content.type) && !/\bhtml\b/i.test(content.type)) return;
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
          filter.disconnect();
          buffer = null;
        }
      };

      if (brokenOnLoad) {
        filter.onstart = event => {
          filter.write(NULL);
        }
      }

      filter.ondata =  event => {
        if (first) {
          runAndFlush();
          first = false;
        }
        if (buffer) {
          buffer.push(event.data);
          return;
        }
        filter.write(event.data);
        filter.disconnect();
      };

    }
  }
}
