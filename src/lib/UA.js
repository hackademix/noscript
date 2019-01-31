var UA = {
  isMozilla: document.URL.startsWith("moz-"),
}

if (!UA.isMozilla && typeof chrome === "object" && !chrome.tabs && typeof exportFunction === "undefined") {
  // content script shims
  window.exportFunction = () => {};
}
