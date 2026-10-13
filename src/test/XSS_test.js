/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
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

if (UA.isMozilla) {
  let y = async (url, originUrl = '') => await XSS.test({originUrl, url, method: "GET"});
  let n = async (...args) => !await y(...args);
  let xssTest = Promise.all([
    () => y("https://noscript.net/<script"),
    () => n("https://noscript.net/<script", "https://noscript.net/"),
    () => y("https://vulnerabledoma.in/char_test?body=%80%3Cscript%3Ealert(1)%3C/script%3E"),
    () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3Ejavascrip%3Cx%3Et:alert(%3Cx%3E1)%3C/p%3E%3Cmath%3E%3Ca%20href=%22%23*/=x.innerText,a%22%20xml:base=javascript:location/*%3EClick%20HERE"),
    () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3E%26lt%3Bsv%3Cx%3Eg%20o%3Cx%3Enload=alert(%3Cx%3E1)%3E%3C/p%3E%3Cmath%3E%3Ca%20href=%23%250ax.innerText%20xml:base=javascript:%3C!--%3EClick%20HERE"),
    () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3E%26lt%3Bsv%3Cx%3Eg%20o%3Cx%3Enload=alert(%3Cx%3E1)%3E%3C/p%3E%3Cmath%3E%3Ca%20href=%23*/x.innerText%20xml:base=%01javascript:/*%3EClick%20HERE"),
    () => y("https://vulnerabledoma.in/char_test?body=%3Ca%20href=javascript%26colo%u0000n%3balert%281%u0029%3ECLICK"),
    () => y("https://vulnerabledoma.in/xss_link?url=javascript%26colo%00n%3Balert%u00281%29"),
    () => y("https://vulnerabledoma.in/xss_link?url=javascript:\\u{%0A6e}ame"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/multibyte/?q=alert(document.cookie)//＜"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/multibyte/?q=/**🚫*/alert(document.cookie)"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/simple_xss.php?name=%22;alert?.(%22NoScript%2011.1.7%20Bypass%20XSS%20@reinforchu%22)//"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/simple_xss.php?name=%22;location?.assign?.(%22https://reinforc.hu%22)//"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/simple_xss.php?name=%22;document?.[%27write%27]?.(%22XSS%22)//"),
    () => y("https://sandbox.hack.vet/issue/noscript/bypass/simple_xss.php?name=%22;document?.[%27write%27]?.(%22%3Cinput%20%22%2b%22+on%22%2b%22focus=alert?.(document?.cookie)%22%2b%22+autofocus%3E%22)//"),
    () => y('https://vulnerabledoma.in/?body=<div onbeforematch="console.log("pwn")" hidden-until="found" id="foo"/>'),
    () => y('https://vulnerabledoma.in/?body=<div oncontentvisibilityautostatechange="console.log("pwn")" />'),
    // due to the use of popover, this is unable to execute functions
    () => y('https://vulnerabledoma.in/?body=<details onbeforetoggle="global += 1000_000" popover/>'),
    /*
    Chromium only, uncomment if/when InjectionChecker will support MV3
    () => y('https://vulnerabledoma.in/?body=<div onscrollsnapchange="console.log("pwn")" class="vuln" />'),
    () => y('https://vulnerabledoma.in/?body=<div onscrollsnapchanging="console.log("pwn")" />'),
    */
      ].map(t => Test.run(t))
    );

    let invalidCharsTest =  async () => {

      await include("xss/InjectionChecker.js");
      let IC = await XSS.InjectionChecker;
      let rx = new IC().invalidCharsRx;
      console.log("Testing invalidCharsRx", rx);
      let x = n => '\\u' + ("0000" + n.toString(16)).slice(-4);
      function check(ch) {
       Function(`let _${ch}_`);
      }
      let cur = 0x7e;
      let fail = false;
      while (cur++ < 0xffff && !fail) {
        let ch = String.fromCharCode(cur);
        try {
          check(ch);
          if (rx.test(ch)) {
            console.error(x(cur) + " should not test invalid!");
            fail = true;
          }
        } catch (e) {
          if (!/illegal char/.test(e.message)) continue;
          if (!rx.test(ch)) {
            console.error(x(cur) + " must test invalid!");
            fail = true;
          }
        }
      }
      return !fail;
    };
    (async () => {
      await xssTest;
      Test.report();
      await Test.run(invalidCharsTest, "InjectionChecker.invalidCharsRx");
      Test.report();
    })();
}
