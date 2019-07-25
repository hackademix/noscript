{
  let mozWebExtUrl = document.URL.startsWith("moz-");
  let isMozilla = mozWebExtUrl || typeof window.wrappedJSObject === "object";
  if (isMozilla) {
    if (mozWebExtUrl) {
      // help browser-specific UI styling
      document.documentElement.classList.add("mozwebext");
    }
  } else {
    // shims for non-Mozilla browsers
    if (typeof chrome === "object" && !chrome.tabs) {
      // content script shims
      if (typeof exportFunction === "undefined") {
        window.exportFunction = () => {};
      }
    }
  }

  var UA = {
    isMozilla
  };
}
