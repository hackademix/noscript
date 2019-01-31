{
  // see https://bugzilla.mozilla.org/show_bug.cgi?id=1415644
  let domains = UA.isMozilla ? [
    "accounts-static.cdn.mozilla.net",
    "accounts.firefox.com",
    "addons.cdn.mozilla.net",
    "addons.mozilla.org",
    "api.accounts.firefox.com",
    "content.cdn.mozilla.net",
    "content.cdn.mozilla.net",
    "discovery.addons.mozilla.org",
    "input.mozilla.org",
    "install.mozilla.org",
    "oauth.accounts.firefox.com",
    "profile.accounts.firefox.com",
    "support.mozilla.org",
    "sync.services.mozilla.com",
    "testpilot.firefox.com",
  ] : [ "chrome.google.com" ];

  function isRestrictedURL(u) {
    try {
      if (typeof u === "string") u = new URL(u);
      let {protocol, hostname} = u;
      return (!/^(?:https?|file|data):$/.test(protocol))
        || protocol === "https:" && hostname && domains.includes(tld.normalize(hostname));
    } catch (e) {
      return false;
    }
  }
}
