'use strict';
{
  let runningScripts = new Map();

  var RequestUtil = {
    async executeOnStart(request, details) {
      let {requestId, tabId, frameId} = request;
      details = Object.assign({
        runAt: "document_start",
        frameId,
      }, details);
      browser.tabs.executeScript(tabId, details);
      return;
      let filter = browser.webRequest.filterResponseData(requestId);
      filter.onstart = event => {
        browser.tabs.executeScript(tabId, details);
        debug("Execute on start", details);
        filter.write(new Uint8Array());
      };
      filter.ondata = event => {
        filter.write(event.data);
        filter.disconnect();

      }
    },
    async executeOnStartCS(request, details) {
      let {url, requestId, tabId, frameId} = request;

      let urlObj = new URL(url);
      if (urlObj.hash || urlObj.port || urlObj.username) {
        urlObj.hash = urlObj.port = urlObj.username = "";
        url = urlObj.toString();
      }
      let wr = browser.webRequest;
      let filter = {
        urls: [`${urlObj.origin}/*`],
        types:  ["main_frame", "sub_frame", "object"]
      };
      let finalize;
      let cleanup = r => {
        if (cleanup && r.requestId === requestId) {
          wr.onCompleted.removeListener(cleanup);
          wr.onErrorOccurred.removeListener(cleanup);
          cleanup = null;
          if (finalize) {
            finalize();
          }
        }
      };
      wr.onCompleted.addListener(cleanup, filter);
      wr.onErrorOccurred.addListener(cleanup, filter);

      details = Object.assign({
        runAt: "document_start",
        frameId,
      }, details);

      if (browser.contentScripts) {
        let js = [{}];
        if (details.file) js[0].file = details.file;
        else if (details.code) js[0].code = details.code;
        let settings = {
          "runAt": details.runAt,
          js,
          matches: [url],
          allFrames: frameId !== 0,
        }
        // let's try to avoid duplicates
        let key = JSON.stringify(settings);
        if (runningScripts.has(key)) {
          let scriptRef = runningScripts.get(key);
          scriptRef.count++;
          return;
        }
        if (settings.allFrames) {
          // let's check whether the same script is registered for top frames:
          // if it is, let's unregister it first to avoid duplicates
          settings.allFrames = false;
          let topKey = JSON.stringify(settings);
          settings.allFrames = true;
          if (runningScripts.has(topKey)) {
            let topScript = runningScripts.get(topKey);
            try {
              topScript.unregister();
            } catch (e) {
              error(e);
            } finally {
              runningScripts.delete(topKey);
            }
          }
        }

        let script = await browser.contentScripts.register(settings);
        debug("Content script %o registered.", settings);
        finalize = () => {
          debug("Finalizing content script %o...", settings);
          try {
            script.unregister();
            runningScripts.delete(key);
            debug("Content script %o unregistered!", settings);
          } finally {
            finalize = null;
          }
        }
        runningScripts.set(key, script);
        if (!cleanup) { // the request has already been interrupted
          finalize();
        }

        return;
      }

      function listener(r) {
        if (r.requestId === requestId) {
          browser.tabs.executeScript(tabId, details);
          finalize();
          finalize = null;
        }
      }
      finalize = () => {
        wr.onResponseStarted.removeListener(listener);
      }
      wr.onResponseStarted.addListener(listener, filter);
      debug("Executing %o", details);

    },


  }
}
