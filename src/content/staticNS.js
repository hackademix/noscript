/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
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

{
  'use strict';
  let listenersMap = new Map();
  let backlog = new Set();

  let ns = {
    debug: true, // DEV_ONLY
    get embeddingDocument() {
      delete this.embeddingDocument;
      return this.embeddingDocument = CSP.isEmbedType(document.contentType);
    },
    on(eventName, listener) {
      let listeners = listenersMap.get(eventName);
      if (!listeners) listenersMap.set(eventName, listeners = new Set());
      listeners.add(listener);
      if (backlog.has(eventName)) this.fire(eventName, listener);
    },
    detach(eventName, listener) {
      let listeners = listenersMap.get(eventName);
      if (listeners) listeners.delete(listener);
    },
    fire(eventName, listener = null) {
      if (listener) {
        listener({type:eventName, source: this});
        return;
      }
      let listeners = listenersMap.get(eventName);
      if (listeners) {
        for (let l of listeners) {
          this.fire(eventName, l);
        }
      }
      backlog.add(eventName);
    },

    fetchPolicy(sync = false) {
      if (this.policy) return;
      let url = window.location.href;
      let origin = window.origin;

      debug(`Fetching policy from document %s (origin %s), readyState %s`,
        url, origin, document.readyState
      );

      if (this.domPolicy) {
        debug("Injected policy found!");
        try {
          this.setup(this.domPolicy);
          return;
        } catch(e) {
          error(e);
        }
      }

      if (this.syncFetchPolicy) {
        // extra hops to ensure that scripts don't run when CSP has not been set through HTTP headers
        this.syncFetchPolicy();
        return;
      }

      this.pendingSyncFetchPolicy = true;

      if (!sync) {
        queueMicrotask(() => this.fetchPolicy(true));
        return;
      }

      if (origin !== 'null' && (window.location.origin !== origin || url.startsWith(`blob:${origin}/`))) {
        debug("Fetching policy for actual URL %s (was %s)", origin, url);
        url = origin;
      }

      if (!this.syncFetchPolicy) {
        this.fetchLikeNoTomorrow(url);
      }
    },

    fetchLikeNoTomorrow(url, setup = this.setup.bind(this)) {
      let msg = {id: "fetchChildPolicy", url};

      let asyncFetch = (async () => {
        let policy = null;
        for (let attempts = 10; !(policy || this.policy) && attempts-- > 0;) {
          try {
            debug(`Retrieving policy asynchronously (${attempts} attempts left).`);
            policy = await Messages.send(msg.id, msg) || this.domPolicy;
            debug("Asynchronous policy", policy);
          } catch (e) {
            error(e, "(Asynchronous policy fetch)");
          }
        }
        setup(policy);
      });

      if (!this.syncFetchPolicy && this.embeddingDocument) {
        asyncFetch();
        return;
      }
      debug(`Synchronously fetching policy for ${url}.`);
      let policy = null;
      let attempts = 100;
      let refetch = () => {
        try {
          policy = browser.runtime.sendSyncMessage(msg) || this.domPolicy;
        } catch (e) {
          error(e);
        }
        if (policy) {
          setup(policy);
        } else if (attempts-- > 0) {
          debug(`Couldn't retrieve policy synchronously (${attempts} attempts left).`);
          if (asyncFetch) {
            asyncFetch();
            asyncFetch = null;
          }
          queueMicrotask(refetch);
        }
      };
      refetch();
    },

    setup(policy) {
      if (this.policy) return false;
      debug("%s, %s, fetched %o", document.URL, document.readyState, policy, new Error().stack); // DEV_ONLY
      if (!policy) {
        policy = {permissions: {capabilities: []}, localFallback: true};
      }
      this.policy = policy;
      if (!policy.permissions || policy.unrestricted) {
        this.allows = () => true;
        this.capabilities =  Object.assign(
          new Set(["script"]), { has() { return true; } });
      } else {
        let perms = policy.permissions;
        if (!(UA.isMozilla || perms.capabilities.includes("script")) &&
          /^file:\/\/\/(?:[^#?]+\/)?$/.test(document.URL)) {
          // Allow Chromium browser UI scripts for directory navigation
          // (for Firefox we rely on emulation in content/ftp.js).
          perms.capabilities.push("script");
        }
        this.capabilities = new Set(perms.capabilities);
        this.CSP = new DocumentCSP(document).apply(this.capabilities, this.embeddingDocument);
      }
      this.canScript = this.allows("script");
      this.fire("capabilities");
      return true;
    },

    policy: null,

    allows(cap) {
      return this.capabilities && this.capabilities.has(cap);
    },
  };
  globalThis.ns = globalThis.ns ? Object.assign(ns, globalThis.ns) : ns;
  debug("StaticNS", Date.now(), JSON.stringify(globalThis.ns)); // DEV_ONLY
  globalThis.ns_setupCallBack = ns.domPolicy
    ? () => {}
    : ({domPolicy}) => {

    };
}
