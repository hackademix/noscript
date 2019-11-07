{
  let p1 = new Policy();
  p1.set("noscript.net", new Permissions(["script"], true));
  p1.set("https://noscript.net", new Permissions(["script", "object"]));
  p1.set("maone.net", p1.TRUSTED.tempTwin);
  p1.set(Sites.secureDomainKey("secure.informaction.com"), p1.TRUSTED);
  p1.set("https://flashgot.net", p1.TRUSTED);
  p1.set("http://flashgot.net", p1.UNTRUSTED);
  p1.set("perchè.com", p1.TRUSTED);
  p1.set("10", p1.TRUSTED);
  p1.set("192.168", p1.TRUSTED);
  p1.set("192.168.69", p1.UNTRUSTED)
  let p2 = new Policy(p1.dry());
  debug("p1", JSON.stringify(p1.dry()));
  debug("p2", JSON.stringify(p2.dry()));
  let onionSecureCurrent = Sites.onionSecure;
  Sites.onionSecure = true;
  p1.set("http://some.onion", p1.TRUSTED);
  for(let t of [
    () => p2.can("https://noscript.net"),
    () => !p2.can("http://noscript.net"),
    () => p2.can("https://noscript.net", "object"),
    () => p1.snapshot !== p2.snapshot,
    () => JSON.stringify(p1.dry()) === JSON.stringify(p2.dry()),
    () => p1.can("http://perchè.com/test") /* IDN encoding */,
    () => Sites.toExternal(new URL("https://perché.com/test")) ===
          "https://perché.com/test" /* IDN decoding */,
    () => !p1.can("http://secure.informaction.com"),
    () => p1.can("https://secure.informaction.com"),
    () => p1.can("https://www.secure.informaction.com"),
    () => !p1.can("https://192.168.69.1"),
    () => !p1.can("https://10.0.0.1"),
    () => p1.can("http://192.168.1.2"),
    () => p1.can("http://some.onion")
  ]) Test.run(t);
  Sites.onionSecure = onionSecureCurrent;
  Test.report();
}
