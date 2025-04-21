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

  const watchList = new WeakSet();
  const blockedList = new WeakSet();
  // Suppress load / error events triggered by resources outside current directory
  // (see tor-browser#43491)

  const isAllowedPath = url => {
    if (url.protocol != "file:") {
      return true;
    }
    const curDir = location.pathname.replace(/[^\/]+$/, "");
    const filePath = url.pathname;
    if (filePath.startsWith(curDir)) {
      return true;
    }
    const {href} = url;
    const allowed = ns?.canXLoad(href);
    notify(href, allowed);
    return allowed;
  };


  const notify = (url, allowed) => {
    const type = "x-load";
    const request = {
      id: "noscript-x-load",
      type,
      url: url.replace(/[^\/]+$/, ""), // truncate to dir
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: type, request, allowed});
    notifyPage();

    return request;

  }

  const block = (el, url = el.currentSrc) => {
    console.warn("Blocking path traversal", url, el);
    const request = notify(url, false);
    // restore full url, notify truncates to dir
    request.url = url;
    if (el.ownerDocument != document) {
      request.offscreen = true;
    }
    try {
      const ph = PlaceHolder.create(request.type, request);
      ph.replace(!request.offscreen && el);
    } catch (e) {
      error(e);
    }
    el.srcset = el.src = "data:"; `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>`;
    blockedList.add(el);
  };

  const suppress = e => {
    if (!e.isTrusted) return;
    const { target } = e;
    const url = new URL(e.filename ||
                        target.currentSrc ||
                        target.src ||
                        target.data ||
                        target.href?.animVal ||
                        target.href,
                        document.baseURI);
    if (!isAllowedPath(url)) {
      if (e.type == "loadstart") {
        block(target);
      }
    } else if (!blockedList.has(target)) {
      return;
    }
    console.warn(`Suppressing on${e.type} event from ${url}`, e.target, e.currentTarget);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  const EVENTS = [
    "abort",
    "canplay",
    "canplaythrough",
    "durationchange",
    "emptied",
    "encrypted",
    "ended",
    "error",
    "loadeddata",
    "loadedmetadata",
    "loadstart",
    "pause",
    "play",
    "playing",
    "progress",
    "ratechange",
    "seeked",
    "seeking",
    "stalled",
    "suspend",
    "timeupdate",
    "volumechange",
    "waiting",
    "waitingforkey",
  ];
  document.addEventListener("load", suppress, true);
  for (const e of EVENTS) {
    addEventListener(e, suppress, true);
  }
  EVENTS.push("load");

  const srcUrls = srcset => {
    const urls = [];
    for (const s of srcset.split(/\s*,s*/)) {
      try {
        urls.push(new URL(s.trim().split(/\s+/)[0], document.baseURI))
      } catch (e) {
      }
    }
    return urls;
  }

  const checkSrc = (el, ...srcAttrs) => {
    if (srcAttrs.length == 0) {
      srcAttrs = ["currentSrc", "src", "srcset"];
    }
    const badSrc =
      el instanceof HTMLImageElement &&
      srcUrls(srcAttrs.map(a => el[a]).join(",")).find(
        (url) => !isAllowedPath(url)
      );
    if (badSrc) {
      block(el, badSrc.toString());
    }
  };

  const watch = watching => {
    checkSrc(watching);
    if (watchList.has(watching)) {
      return;
    }
    observer.observe(watching, mutOpts);
    watchList.add(watching);
    for (const eventType of EVENTS) {
      watching.addEventListener(eventType, suppress, true);
    }
  };

  const mutOpts = {
    childList: true,
    subtree: true,
    attributeFilter: ["src", "srcset"],
  };

  const mutationsCallback = (records, observer) => {
    for (var r of records) {
      switch(r.type) {
        case "childList":
          [...r.addedNodes].forEach(watch);
          [...r.removedNodes].forEach(removed => {
            watch(removed);
            observer.observe(removed, mutOpts);
          });
        break;
        case "attributes":
          checkSrc(r.target, r.attributeName);
        break;
      }
    }
  };

  const observer = new MutationObserver(mutationsCallback);
  observer.observe(document.documentElement, mutOpts);

  Worlds.connect("eventsHook", {
    onConnect: port => {},
    onMessage: ({watching}) => {
      watch(watching);
    },
  });
}
