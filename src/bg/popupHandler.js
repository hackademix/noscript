browser.runtime.onConnect.addListener(port => {
  if (port.name === "noscript.popup") {
    let pendingReload = false;
    let tabId = -1;
    port.onMessage.addListener(m => {
      if ("pendingReload" in m) {
        tabId = m.tabId;
        pendingReload = m.pendingReload;
      }
    });
    port.onDisconnect.addListener(() => {
      if (pendingReload) {
        browser.tabs.reload(tabId);
      }
    });
  }
});
