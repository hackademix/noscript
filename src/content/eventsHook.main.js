/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2025 Giorgio Maone <https://maone.net>
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

'use strict';

if (location.protocol == "file:") {
  const {exportFunction, patchWindow} = Worlds.main;

  function modifyWindow(scope, {port, xray}) {
    const { window } = xray;
    const { Proxy, document } = window;

    const { Reflect } = globalThis;

    const { addEventListener } = window.EventTarget.prototype;
    const nodeProps = {};
    for (const prop of ["ownerDocument", "parentNode", "nextSibling"]) {
      nodeProps[prop] = xray.getSafeDescriptor(Node.prototype, prop, "get").get;
    }
    for (const method of ["insertBefore", "removeChild"]) {
      nodeProps[method] = Node.prototype[method];
    }
    const adoptNode = document.adoptNode;
    const getDocumentElement = xray.getSafeDescriptor(Document.prototype, "documentElement", "get").get;

    const watchList = new WeakSet();

    const NO_ARGS = [];
    const call = (func, obj, ...args) => Reflect.apply(func, obj, args || NO_ARGS);

    const watch = watching => {
      if (!watchList.has(watching)) {
        const ownerDocument =  call(nodeProps.ownerDocument, watching);
        const crossDoc = ownerDocument != document;
        const parentNode = call(nodeProps.parentNode, watching);

        if (!crossDoc && parentNode) {
          // Nothing to do: eventHook.js' MutationObserver should kick in
          return;
        }

        if (xray.enabled) {
          port.postMessage({watching});
          watchList.add(watching);
          return;
        }

        // Chromium cannot marshall DOM nodes in port.postMessage():
        // following hack triggers eventHook.js' mutation observer instead.

        const nextSibling = call(nodeProps.nextSibling, watching);
        if (crossDoc) {
          call(adoptNode, document, watching);
        }
        const documentElement = call(getDocumentElement, document);
        call(nodeProps.insertBefore, documentElement, watching, null);
        call(nodeProps.removeChild, documentElement, watching);
        if (crossDoc) {
          // put the node back at its place in its document
          call(adoptNode, ownerDocument, watching);
          if (parentNode) {
            call(nodeProps.insertBefore, ownerDocument,  watching, nextSibling);
          }
        }
      }
    }

    exportFunction(function(...args) {
      watch(this);
      return addEventListener.call(this, ...args);
    }, EventTarget.prototype, {defineAs: "addEventListener"});

    // patch every new node
    const nodeCreators = {
      "Document":  ["createElement", "createElementNS", "createDocumentFragment"],
      "Node": ["cloneNode"],
    }
    for (const clazz in nodeCreators) {
      const proto = window[clazz].prototype;
      for (const m of nodeCreators[clazz]) {
        const method = proto[m];
        exportFunction(function (...args) {
          const node = method.call(this, ...args);
          watch(node);
          return node;
        }, proto, { defineAs: m });
      }
    }

    // Intercept Image and Audio constructors

    const construct = Reflect.construct.bind(Reflect);
    const constructorHandler = {
      construct(target, args) {
        const i = construct(target, args);
        watch(i);
        return i;
      }
    };
    xray.proxify("Image", constructorHandler);
    xray.proxify("Audio", constructorHandler);
  }

  Worlds.connect("eventsHook.main", {
    onConnect: port => {
      patchWindow(modifyWindow, {port});
    },
    onMessage: m => {
    },
  });
}