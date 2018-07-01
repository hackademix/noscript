'use strict';
{
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
  var RequestUtil = {
    async executeOnStart(request, details) {
      let {requestId, tabId, frameId} = request;
      let scripts = pendingRequests.get(requestId);
      let scriptKey = JSON.stringify(details);
      if (!scripts) {
        pendingRequests.set(requestId, scripts = new Map());
        scripts.set(scriptKey, details);
      } else {
        scripts.set(scriptKey, details);
        return;
      }

      let filter = browser.webRequest.filterResponseData(requestId);
      let buffer = [];
      filter.onstart = async event => {
        filter.write(new Uint8Array());
        for (let details of scripts.values()) {
          details = Object.assign({
            runAt: "document_start",
            frameId,
          }, details);
          try {
            await browser.tabs.executeScript(tabId, details);
            debug("Execute on start OK", request.url, details);
          } catch (e) {
            error(e, "Execute on start failed", request.url, details);
          }
        }
        if (buffer.length) {
          debug("Flushing %s buffer chunks", buffer.length);
          for (let chunk of buffer) {
            filter.write(chunk);
          }
          filter.disconnect();
          buffer = null;
        }
      };
      filter.ondata = event => {
        if (buffer) {
          buffer.push(event.data);
          return;
        }
        filter.write(event.data);
        filter.disconnect();
      }
    }
  }
}
