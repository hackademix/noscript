"use strict";
var Storage = (() => {

  let chunksKey = k => `${k}/CHUNKS`;

  async function safeOp(op, type, keys) {
    let sync = type === "sync";

    try {
      if (sync) {
        let remove = op === "remove";
        if (remove || op === "get") {
          keys = [].concat(keys); // don't touch the passed argument
          let mergeResults = {};
          let localFallback = await getLocalFallback();
          if (localFallback.size) {
            let localKeys = keys.filter(k => localFallback.has(k));
            if (localKeys.length) {
              if (remove) {
                await browser.storage.local.remove(localKeys);
                for (let k of localKeys) {
                  localFallback.delete(k);
                }
                await setLocalFallback(localFallback);
              } else {
                mergeResults = await browser.storage.local.get(localKeys);
              }
              keys = keys.filter(k => !localFallback.has(k));
            }
          }

          if (keys.length) { // we may not have non-fallback keys anymore
            let chunkCounts = Object.entries(await browser.storage.sync.get(
                keys.map(chunksKey)))
                  .map(([k, count]) => [k.split("/")[0], count]);
            if (chunkCounts.length) {
              let chunkedKeys = [];
              for (let [k, count] of chunkCounts) {
                // prepare to fetch all the chunks at once
                while (count-- > 0) chunkedKeys.push(`${k}/${count}`);
              }
              if (remove) {
                let doomedKeys = keys
                  .concat(chunkCounts.map(([k, count]) => chunksKey(k)))
                  .concat(chunkedKeys);
                return await browser.storage.sync.remove(doomedKeys);
              } else {
                let chunks = await browser.storage.sync.get(chunkedKeys);
                for (let [k, count] of chunkCounts) {
                  let orderedChunks = [];
                  for (let j = 0; j < count; j++) {
                    orderedChunks.push(chunks[`${k}/${j}`]);
                  }
                  let whole = orderedChunks.join('');
                  try {
                    mergeResults[k] = JSON.parse(whole);
                    keys.splice(keys.indexOf(k), 1); // remove from "main" keys
                  } catch (e) {
                    error(e, "Could not parse chunked storage key %s (%s).", k, whole);
                  }
                }
              }
            }
          }
          return keys.length ?
            Object.assign(mergeResults, await browser.storage.sync[op](keys))
            : mergeResults;
        } else if (op === "set") {
          keys = Object.assign({}, keys); // don't touch the passed argument
          const MAX_ITEM_SIZE = 4096;
          // Firefox Sync's max object BYTEs size is 16384, Chrome's 8192.
          // Rather than mesuring actual bytes, we play it safe by halving then
          // lowest to cope with escapes / multibyte characters.
          let removeKeys = [];
          for (let k of Object.keys(keys)) {
            let s = JSON.stringify(keys[k]);
            let chunksCountKey = chunksKey(k);
            let oldCount = await browser.storage.sync.get(chunksCountKey)[chunksCountKey] || 0;
            let count;
            if (s.length > MAX_ITEM_SIZE) {
              count = Math.ceil(s.length / MAX_ITEM_SIZE);
              let chunks = {
                [chunksCountKey]: count
              };
              for(let j = 0, o = 0; j < count; ++j, o += MAX_ITEM_SIZE) {
                chunks[`${k}/${j}`] = s.substr(o, MAX_ITEM_SIZE);
              }
              await browser.storage.sync.set(chunks);
              keys[k] = "[CHUNKED]";
            } else {
              count = 0;
              removeKeys.push(chunksCountKey);
            }
            if (oldCount-- > count) {
              do {
                removeKeys.push(`${k}${oldCount}`);
              } while(oldCount-- > count);
            }
          }
          await browser.storage.sync.remove(removeKeys);
        }
      }

      let ret = await browser.storage[type][op](keys);
      if (sync && op === "set") {
        let localFallback = await getLocalFallback();
        let size = localFallback.size;
        if (size > 0) {
          for (let k of Object.keys(keys)) {
            localFallback.delete(k);
          }
          if (size > localFallback.size) {
            await setLocalFallback(localFallback);
          }
        }
      }
      return ret;
    } catch (e) {
      error(e, "%s.%s(%o)", type, op, keys);
      if (sync) {
        debug("Sync disabled? Falling back to local storage (%s %o)", op, keys);
        let localFallback = await getLocalFallback();
        let failedKeys = Array.isArray(keys) ? keys
          : typeof keys === "string" ? [keys] : Object.keys(keys);
        for (let k of failedKeys) {
          localFallback.add(k);
        }
        await setLocalFallback(localFallback);
      } else {
        throw e;
      }
    }

    return await browser.storage.local[op](keys);
  }

  const LFK_NAME = "__fallbackKeys";
  async function setLocalFallback(keys) {
    return await browser.storage.local.set({[LFK_NAME]: [...keys]});
  }
  async function getLocalFallback() {
    let keys = (await browser.storage.local.get(LFK_NAME))[LFK_NAME];
    return new Set(Array.isArray(keys) ? keys : []);
  }

  return {
    async get(type, keys) {
      return await safeOp("get", type, keys);
    },

    async set(type, keys) {
      return await safeOp("set", type, keys);
    },

    async remove(type, keys) {
      return await safeOp("remove", type, keys);
    },

    async hasLocalFallback(key) {
      return (await getLocalFallback()).has(key);
    },

    async isChunked(key) {
      let ccKey = chunksKey(key);
      let data = await browser.storage.sync.get([key, ccKey]);
      return data[key] === "[CHUNKED]" && parseInt(data[ccKey]);
    }
  };
})()
