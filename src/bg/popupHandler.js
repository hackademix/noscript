browser.runtime.onConnect.addListener(port => {
  if (port.name === "noscript.popup") {
    ns.popupOpened = true;
    let pendingReload = false;
    let tabId = -1;
    port.onMessage.addListener(m => {
      if ("pendingReload" in m) {
        tabId = m.tabId;
        pendingReload = m.pendingReload;
      }
    });
    port.onDisconnect.addListener(() => {
      ns.popupOpened = false;
      if (pendingReload) {
        browser.tabs.reload(tabId);
      }
    });
  }
});
