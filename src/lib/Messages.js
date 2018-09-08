"use strict";
{
  let handlers = new Set();

  let dispatch = async (msg, sender) => {
    let {__meta} = msg;
    let {name} = __meta;
    let answers = [];
    for (let h of handlers) {
      let f = h[name];
      if (typeof f === "function") {
        answers.push(f(msg, sender));
      }
    }
    if (answers.length) {
      return await (
        answers.length === 1 ? answers.pop(): Promise.all(answers)
      );
    }
    let context = typeof window === "object" && window.location || null;
    let originalSender = __meta.originalSender || sender;
    console.debug("Warning: no handler for message %o in context %s", msg, context);
    if (originalSender.tab && originalSender.tab.id) {
      // if we're receiving a message from content, there might be another
      // Messages instance in a different context (e.g. background page vs
      // options page vs browser action) capable of processing it, and we've
      // just "steal" it. Let's rebroadcast.
      return await Messages.send(name, msg, {originalSender});
    }
    throw new Error(`No handler registered for message "${name}" in context ${context}`);
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
        browser.runtime.onMessage.removeListener(dispatch);
      }
    },
    async send(name, args = {}, recipientInfo = null) {
      args.__meta = {name, recipientInfo};
      if (recipientInfo && "tabId" in recipientInfo) {
        let opts;
        if ("frameId" in recipientInfo) opts = {frameId: recipientInfo.frameId};
        return await browser.tabs.sendMessage(recipientInfo.tabId, args, opts);
      }
      return await browser.runtime.sendMessage(args);
    }
  }
}
