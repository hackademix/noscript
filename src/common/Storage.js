var Storage = {

  async safeOp(op, type, keys) {
    try {
      return await browser.storage[type][op](keys);
    } catch (e) {
      if (type === "sync") {
        debug("Sync disabled? Falling back to local storage (%s %o)", op, keys);
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
  }
}
