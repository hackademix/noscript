/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
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
{
  debug(`Prerendering: ${document.prerendering}`, self.performance?.getEntriesByType?.('navigation')[0]?.activationStart); // DEV_ONLY

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
        debug(`Fetching policy for actual URL ${origin} (was ${url})`);
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
            debug(`Retrieving policy asynchronously for ${document.readyState} ${url} (${attempts} attempts left).`);
            policy = await Messages.send(msg.id, msg) || this.domPolicy;
            debug("Asynchronous policy", policy);
          } catch (e) {
            if (/An unexpected error occurred/.test(e)) {
              // This might be just the browser context unloading:
              // if that's the case, deferring suppresses the console spam
              setTimeout(() => error(e, "(deferred - Asynchronous policy fetch)"), 0);
            } else {
              error(e, "(Asynchronous policy fetch)");
            }
          }
        }
        setup(policy);
      });
      const {readyState} = document;
      asyncFetch();
      // WARNING: be careful adding exceptions to sync fetching here, since on MV3 we never have
      // content-blocking CSP headers injected at the network level (DNRPolicy.js doesn't).
      if (this.policy || readyState == "complete" ||
          window.origin == "null" && window.location.href == "about:blank" && window.top == self
      ) {
        // no point trying sync too in these cases
        return;
      }
      debug(`Synchronously fetching policy for ${readyState} ${url}.`);

      let policy = null;
      try {
        policy = browser.runtime.sendSyncMessage(msg);
      } catch (e) {
        console.error("Failed to use sendSyncMessage", e);
      }
      policy ||= this.domPolicy;
      if (policy) {
        setup(policy);
        return;
      }
      queueMicrotask(() => {
        if (this.policy) {
          return;
        }
        if (this.domPolicy) {
          setup(this.domPolicy);
        } else {
          DocumentFreezer.freeze();
        }
      });
    },

    setup(policy) {
      if (this.policy) return false;
      debug("%s, %s, fetched %o, domPolicy? %s", document.URL, document.readyState, policy, policy == this.domPolicy, new Error().stack); // DEV_ONLY
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
          // (for Firefox we rely on emulation in content/dirindex.js).
          perms.capabilities.push("script");
        }
        this.capabilities = new Set(perms.capabilities);
        this.CSP = new DocumentCSP(document).apply(this.capabilities, this.embeddingDocument);
      }
      this.canScript = this.allows("script");
      this.fire("capabilities");

      if (DocumentFreezer.isFrozen) {
        if (!this.canScript) {
          if (location.protocol.startsWith("http")) {
            DocumentFreezer.unfreezeLive();
          }
        } else {
          DocumentFreezer.unfreezeAutoReload();
        }
      }
      return true;
    },

    policy: null,

    allows(cap) {
      return this.capabilities?.has(cap);
    },

    canXLoad(url) {
      return this.policy?.xLoadable?.some(parentDir => url.startsWith(parentDir));
    }
  };
  globalThis.ns = globalThis.ns ? Object.assign(ns, globalThis.ns) : ns;
  globalThis.ns_setupCallback = ns.domPolicy
    ? () => {}
    : (domPolicy) => {
      ns.domPolicy = domPolicy;
      if (ns.setup) {
        if (ns.syncSetup) ns.syncSetup(domPolicy);
        else ns.setup(domPolicy);
      }
    };
    debug("StaticNS inited", document.URL, window.origin, Date.now(), JSON.stringify(globalThis.ns)); // DEV_ONLY
}
