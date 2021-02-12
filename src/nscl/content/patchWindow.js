"use strict";

function patchWindow(patchingCallback, env = {}) {
  let nativeExport = this && this.exportFunction || typeof exportFunction == "function";
  if (!nativeExport) {
    // Chromium
    let exportFunction = (func, targetObject, {defineAs}) => {
      let original = targetObject[defineAs];
      console.log(`Setting ${targetObject}.${defineAs}`, func);
      targetObject[defineAs] = new Proxy(original, {
        apply(target, thisArg, args) { 
          return func.apply(thisArg, args); 
        }
      });
    };
    let cloneInto = (obj, targetObject) => {
      return obj; // dummy for assignment
    };
    let script = document.createElement("script");
    script.text = `
    (() => {
      console.log("Chromium patchWindow");
      let patchWindow = ${patchWindow};
      let cloneInto = ${cloneInto};
      let exportFunction = ${exportFunction};
      ({
        patchWindow,
        exportFunction,
        cloneInto,
      }).patchWindow(${patchingCallback}, ${JSON.stringify(env)});
    })();
    `;
    document.documentElement.insertBefore(script, document.documentElement.firstChild);
    script.remove();
    return;
  }

  // win: window object to modify.
  // modifyTarget: callback to function that modifies the desired properties
  //                or methods. Callback must take target window as argument.
  function modifyWindow(win, modifyTarget) {
    try {
      modifyTarget(win.wrappedJSObject || win, env);
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
      for (let iface of ["Frame", "IFrame", "Object"]) {
        let proto = win[`HTML${iface}Element`].prototype;
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

  return modifyWindow(window, patchingCallback);
}
