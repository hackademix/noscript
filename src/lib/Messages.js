"use strict";
{
  let handlers = new Set();
  
  let dispatch = async (msg, sender) => {
    let {action} = msg;
    for (let h of handlers) {
      let f = h[action];
      if (typeof f === "function") {
        return await f(msg, sender);
      }
    }
  };
  
  var Messages = {
    addHandler(handler) {
      let originalSize = handlers.size;
      handlers.add(handler);
      if (originalSize === 0 && handlers.size === 1) {
        browser.runtime.onMessage.addListener(dispatch);
      }
    },
    removeHandler(handler) {
      let originalSize = handlers.size;
      handlers.delete(handler);
      if (originalSize === 1 && handlers.size === 0) {
        browser.runtime.onMessage.remveListener(dispatch);
      }
    }
  }
}
