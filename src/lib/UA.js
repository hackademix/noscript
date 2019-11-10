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
    }
  }

  var UA = {
    isMozilla
  };
}
