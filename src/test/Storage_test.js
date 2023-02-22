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

"use strict";
{
  let makeBigObj = propsNum => {
    let bigObj = {};
    for (let j = propsNum; j-- > 0;) {
      let x = "0000".concat(j.toString(16)).slice(-4);
      bigObj[`k${x}`] = `v${x}`;
    }
    log("[TEST] created bigObj %s JSON characters long.", JSON.stringify(bigObj).length)
    return bigObj;
  }
  let HUGE_SIZE = 16000,
      BIG_SIZE = 1000;
  let bigObject = makeBigObj(BIG_SIZE);
  let hugeObject = makeBigObj(HUGE_SIZE);
  let items = {"small1": {x: 1, y: 2}, bigObject, "small2": {k:3, j: 4}};
  let keys = Object.keys(items);
  keys.push("hugeObject");

  let eq = async (key, prop, val) => {
    let current = (await Storage.get("sync", key))[key];
    let ok = current[prop] === val;
    log("[TEST] sync.%s.%s %s %s\n(%o)", key, prop, ok ? "==" : "!=", val, current);
    return ok;
  };

  let fallbackOrChunked = async key => {
    let fallback = await Storage.hasLocalFallback(key);
    let chunked = await Storage.isChunked(key);
    log("[TEST] %s fallback: %s, chunked: %s", key, fallback, chunked);
    return fallback ? !chunked : chunked;
  }

  let checkSize = async (key, size) =>
    Object.keys((await Storage.get("sync", key))[key]).length === size;

  let all;

  (async () => {
    for(let t of [
      async () => {
        await Storage.set("sync", items)
        await Storage.set("sync", {hugeObject});  // fallback to local
        all = await Storage.get("sync", keys);
        log("[TEST] Storage:\nsync %o\nlocal %o\nfiltered (%o) %o",
              await browser.storage.sync.get(),
              await browser.storage.local.get(),
              keys, all);
        return Object.keys(all).length === keys.length;
      },
      async () => checkSize("hugeObject", HUGE_SIZE),
      async () => checkSize("bigObject", BIG_SIZE),
      async () => await fallbackOrChunked("bigObject"),
      async () => await fallbackOrChunked("hugeObject"),
      async () => await eq("small1", "y", 2),
      async () => await eq("small2", "k", 3),
      async () => await eq("bigObject", "k0000", "v0000"),
      async () => await eq("hugeObject", "k0001", "v0001"),
      async () => {
        let key = "bigObject";
        let wasChunked = await Storage.isChunked(key);
        await Storage.set("sync", {[key]: {tiny: "prop"}});
        return wasChunked && !(await Storage.isChunked(key));
      },
      async () => eq("bigObject", "tiny", "prop"),
      async  () => {
        await Storage.remove("sync", keys);
        let myItems = await Storage.get("sync", keys);
        return Object.keys(myItems).length === 0;
      },
    ]) {
      await Test.run(t);
    }
    Test.report();
  })();
}
