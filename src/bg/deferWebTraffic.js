function deferWebTraffic(promiseToWaitFor, next) {
  debug("deferWebTraffic on %o", promiseToWaitFor);
  let seenTabs = new Set();
  function checkNavigation(nav) {
    if (nav.tabId !== browser.tabs.TAB_ID_NONE && nav.url.startsWith("http")) {
      let seen = seenTabs.has(nav.tabId);
      debug(`%s navigation %o`, seen ? "seen" : "unseen", nav);
      if (!seen) {
        reloadTab(nav.tabId);
      }
    }
  }
  browser.webNavigation.onCommitted.addListener(checkNavigation);
  function reloadTab(tabId) {
    seenTabs.add(tabId);
    try {
      browser.tabs.executeScript(tabId, {
        runAt: "document_start",
        code: "if (performance.now() < 60000) window.location.reload(false)"
      });
      debug("Reloading tab", tabId);
    } catch (e) {
      error(e, "Can't reload tab", tabId);
    }
  }

   async function waitFor(request) {
    let {type, documentUrl, url, tabId, frameId} = request;
    if (tabId === browser.tabs.TAB_ID_NONE) return;
    if (!seenTabs.has(tabId)) {
      if (type === "main_frame") {
        seenTabs.add(tabId);
      } else if (documentUrl) {
        if (frameId !== 0 && request.frameAncestors) {
          documentUrl = request.frameAncestors.pop().url;
        }
        reloadTab(tabId);
      }
    }
    debug("Deferring %s %s from %s", type, url, documentUrl);
    try {
      await promiseToWaitFor;
    } catch (e) {
      error(e);
    }
    debug("Green light to %s %s from %s", type, url, documentUrl);
  }

  function spyTabs(request) {
    debug("Spying request %o", request);
  }

  browser.webRequest.onHeadersReceived.addListener(spyTabs, {
    urls: ["<all_urls>"],
    types: ["main_frame"],
  }, ["blocking", "responseHeaders"]);
  browser.webRequest.onBeforeRequest.addListener(waitFor, {
    urls: ["<all_urls>"]
  }, ["blocking"]);

  (async () => {
    await promiseToWaitFor;
    browser.webNavigation.onCommitted.removeListener(checkNavigation);
    browser.webRequest.onBeforeRequest.removeListener(waitFor);
    browser.webRequest.onHeadersReceived.removeListener(spyTabs);
    if (next) next();
  })();
}
