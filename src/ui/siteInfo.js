(async () => {
  let [domain, tabId] = decodeURIComponent(location.hash.replace("#", "")).split(";");
  const BASE =  "https://noscript.net";
  await include(['/lib/punycode.js', '/common/Storage.js']);
  let {siteInfoConsent} = await Storage.get("sync", "siteInfoConsent");
  if (!siteInfoConsent) {
    await include('/common/locale.js');
    siteInfoConsent = confirm(_("siteInfo_confirm", [domain, BASE]));
    if (siteInfoConsent) {
      await Storage.set("sync", {siteInfoConsent});
    } else {
      let current = await browser.tabs.getCurrent();
      await browser.tabs.update(parseInt(tabId), {active: true});
      await browser.tabs.remove(current.id);
      return;
    }
  }
  let ace  = punycode.toASCII(domain);
  location.href = `${BASE}/about/${domain};${ace}`;
})();
