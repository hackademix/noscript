/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

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
  p1.set("192.168.69", p1.UNTRUSTED);
  p1.set("facebook.net", new Permissions([], false,
    new Sites([[Sites.optimalKey("https://facebook.com"), p1.TRUSTED]])));
  // secureDomainKey should be "downgraded" by UNTRUSTED, issue #126
  p1.set(Sites.secureDomainKey("evil.com"), p1.UNTRUSTED);
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
    () => p1.can("http://some.onion"),
    () => !p1.can("http://evil.com"),
    () => !p1.can("https://facebook.net"),
    () => p1.can("https://facebook.net", "script", "https://www.facebook.com"),
    () => !p1.can("https://facebook.net", "script", "http://facebook.com"),
  ]) Test.run(t);
  Sites.onionSecure = onionSecureCurrent;
  Test.report();
}
