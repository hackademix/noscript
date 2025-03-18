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
    const {window} = xray;

    const { Proxy } = window;
    const { addEventListener } = window.EventTarget.prototype;

    const watchList = new WeakSet();

    const watch = watching => {
      if (!watchList.has(watching)) {
        port.postMessage({watching});
        watchList.add(watching);
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

    // Intercept Image constructor

    const construct = Reflect.construct.bind(Reflect);
    const constructorHandler = {
      construct(target, args) {
        const i = construct(target, args);
        watch(i);
        return i;
      }
    };
    xray.proxify("Image", constructorHandler);
  }

  Worlds.connect("eventsHook.main", {
    onConnect: port => {
      patchWindow(modifyWindow, {port});
    },
    onMessage: m => {
    },
  });
}