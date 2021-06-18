/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
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

    fetchPolicy() {
      if (this.policy) return;
      let url = document.URL;

      debug(`Fetching policy from document %s, readyState %s`,
        url, document.readyState
        //, document.domain, document.baseURI, window.isSecureContext // DEV_ONLY
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

      if (/^(?:ftp|file):/.test(url)) { // ftp: or file: - no CSP headers yet
        if (this.syncFetchPolicy) {
          this.syncFetchPolicy();
        } else { // additional content scripts not loaded yet
          log("Waiting for syncFetchPolicy to load...");
          this.pendingSyncFetchPolicy = true;
          return;
        }
      } else {
        // CSP headers have been already provided by webRequest, we are not in a hurry...
        if (url.startsWith("blob:")) {
          url = location.origin;
        } else if (/^(?:javascript|about):/.test(url)) {
          url = document.readyState === "loading"
          ? document.baseURI
          : `${window.isSecureContext ? "https" : "http"}://${document.domain}`;
          debug("Fetching policy for actual URL %s (was %s)", url, document.URL);
        }
        let asyncFetch = async () => {
          try {
            policy = await Messages.send("fetchChildPolicy", {url, contextUrl: url});
          } catch (e) {
            error(e, "Error while fetching policy");
          }
          if (policy === undefined) {
            let delay = 300;
            log(`Policy was undefined, retrying in ${delay}ms...`);
            setTimeout(asyncFetch, delay);
            return;
          }
          this.setup(policy);
        }
        asyncFetch();
        return;
      }
    },

    setup(policy) {
      if (this.policy) return false;
      debug("%s, %s, fetched %o", document.URL, document.readyState, policy);
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
        if (!perms.capabilities.includes("script") && /^file:\/\/\/(?:[^#?]+\/)?$/.test(document.URL)) {
          // allow browser UI scripts for directory navigation
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
  window.ns = window.ns ? Object.assign(ns, window.ns) : ns;
  debug("StaticNS", Date.now(), JSON.stringify(window.ns)); // DEV_ONLY
}
