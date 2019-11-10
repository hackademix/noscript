if (typeof exportFunction === "function") ns.on("capabilities", event => {
  debug("WebGL Hook", document.URL, document.documentElement && document.documentElement.innerHTML, ns.capabilities); // DEV_ONLY
  if (ns.allows("webgl")) return;

  // win: window object to modify.
  // modifyTarget: callback to function that modifies the desired properties
  //                or methods. Callback must take target window as argument.
  function modifyWindow(win, modifyTarget) {
    try {
      modifyTarget(win);
      modifyWindowOpenMethod(win, modifyTarget);
      modifyFramingElements(win, modifyTarget);
    } catch (e) {
      if (e instanceof DOMException && e.name === "SecurityError") {
        // In case someone tries to access SOP restricted window.
        // We can just ignore this.
      } else throw e;
    }
  }

  function modifyWindowOpenMethod(win, modifyTarget) {
    let windowOpen = win.wrappedJSObject ? win.wrappedJSObject.open : win.open;
    exportFunction(function(...args) {
      let newWin = windowOpen.call(this, ...args);
      if (newWin) modifyWindow(newWin, modifyTarget);
      return newWin;
    }, win, {defineAs: "open"});
  }

  function modifyFramingElements(win, modifyTarget) {
    for (let property of ["contentWindow", "contentDocument"]) {
      for (let interface of ["Frame", "IFrame", "Object"]) {
        let proto = win[`HTML${interface}Element`].prototype;
        modifyContentProperties(proto, property, modifyTarget)
      }
    }
  }

  function modifyContentProperties(proto, property, modifyTarget) {
    let descriptor = Object.getOwnPropertyDescriptor(proto, property);
    let origGetter = descriptor.get;
    let replacementFn;

    if (property === "contentWindow") { replacementFn = function() {
      let win = origGetter.call(this);
      if (win) modifyWindow(win, modifyTarget);
      return win;
    }}
    if (property === "contentDocument") { replacementFn = function() {
      let document = origGetter.call(this);
      if (document && document.defaultView) modifyWindow(document.defaultView, modifyTarget);
      return document;
    }}

    descriptor.get = exportFunction(replacementFn, proto, {defineAs: `get $property`});
    let wrappedProto = proto.wrappedJSObject || proto;
    Object.defineProperty(wrappedProto, property, descriptor);
  }

  //

  function modifyGetContext(win) {
      let proto = win.HTMLCanvasElement.prototype;
      let getContext = proto.getContext;
      exportFunction(function(type, ...rest) {
        if (type && type.toLowerCase().includes("webgl")) {
          let request = {
            id: "noscript-webgl",
            type: "webgl",
            url: document.URL,
            documentUrl: document.URL,
            embeddingDocument: true,
          };
          seen.record({policyType: "webgl", request, allowed: false});
          try {
            let ph = PlaceHolder.create("webgl", request);
            ph.replace(this);
            PlaceHolder.listen();
          } catch (e) {
            error(e);
          }
          notifyPage();
          return {};
        }
        return getContext.call(this, type, ...rest);
      }, proto, {defineAs: "getContext"});
  }

  modifyWindow(window, modifyGetContext);

});
