var Storage = {

  async safeOp(op, type, keys) {
    let sync = type === "sync";
    if (sync && op === "get") {
      let localFallback = await this.localFallback();
      if (localFallback.size) {
        for (let k of Array.isArray(keys) ? keys : [keys]) {
          if (localFallback.has(k)) {
            type = "local";
            break;
          }
        }
      }
    }
    try {
      let ret = await browser.storage[type][op](keys);
      if (sync && op === "set") {
        let localFallback = await this.localFallback();
        let size = localFallback.size;
        if (size > 0) {
          for (let k of Object.keys(keys)) {
            localFallback.delete(k);
          }
          if (size > localFallback.size) this.localFallback(localFallback);
        }
      }
      return ret;
    } catch (e) {
      if (sync) {
        debug("Sync disabled? Falling back to local storage (%s %o)", op, keys);
        let localFallback = await this.localFallback();
        let failedKeys = Array.isArray(keys) ? keys
          : typeof keys === "string" ? [keys] : Object.keys(keys);
        for (let k of failedKeys) {
          localFallback.add(k);
        }
        await this.localFallback(localFallback);
      } else {
        error(e);
        throw e;
      }
    }

    return await browser.storage.local[op](keys);
  },

  async get(type, keys) {
    return await this.safeOp("get", type, keys);
  },

  async set(type, keys) {
    return await this.safeOp("set", type, keys);
  },

  async localFallback(keys) {
    let name = "__fallbackKeys";
    if (keys) {
      return await browser.storage.local.set({[name]: [...keys]});
    }
    let fallbackKeys = (await browser.storage.local.get(name))[name];
    return new Set(Array.isArray(fallbackKeys) ? fallbackKeys : []);
  }
}
