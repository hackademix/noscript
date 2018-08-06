/**
* Wrapper around listeners on various WebExtensions
* APIs (e.g. webRequest.on*), as a best effort to 
* let them run last by removing and re-adding them 
* on each call (swapping 2 copies because 
* addListener() calls are asynchronous).
* Note: we rely on implementation details Like
* listeners being called in addition order; also,
* clients should ensure they're not called twice for
* the same event, if that's important.
}
*/

class LastListener {
  constructor(observed, listener, ...extras) {
    this.observed = observed;
    this.listener = listener;
    this.extras = extras;
    let ww = this._wrapped = [listener, listener].map(l => {
      let w = (...args) => {
        if (this.observed.hasListener(w._other)) {
          this.observed.removeListener(w._other);
          if (this.last === w) return this.defaultResult;
        } else if (this.installed) { 
          this.observed.addListener(w._other, ...this.extras);
          this.last = w._other;
        }
        return this.installed ? this.listener(...args)
          : this.defaultResult;
      }
      return w;
    });
    
    ww[0]._other = ww[1];
    ww[1]._other = ww[0];
    this.installed = false;
    this.defaultResult = null;
  }

  install() {
    if (this.installed) return;
    this.observed.addListener(this._wrapped[0], ...this.extras);
    this.installed = true;
  }
  
  uninstall() {
    this.installed = false;
    for (let l of this._wrapped) this.observed.removeListener(l);
  }
}
