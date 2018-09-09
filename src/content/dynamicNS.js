'use strict';

// ensure the order which manifest scripts and dynamically registered scripts
// are executed in doesn't matter for initialization, by using a stub.

if (!this.ns) {
  let deferredSetup = null;
  let nsStub = this.ns = {
    config: {},
    setup(CURRENT, MARKER) {
      deferredSetup = [CURRENT, MARKER];
    },
    merge: ns => {
      ns.config = Object.assign(ns.config, nsStub.config);
      this.ns = ns;
      if (deferredSetup) {
        ns.setup(...deferredSetup);
      }
    }
  }
}
