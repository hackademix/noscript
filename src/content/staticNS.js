{
  'use strict';
  let listenersMap = new Map();
  let backlog = new Set();
  let documentCSP = new DocumentCSP(document);

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
      let url = document.URL;

      debug(`Fetching policy from document %s, readyState %s`,
        url, document.readyState
        //, document.domain, document.baseURI, window.isSecureContext // DEV_ONLY
      );

      let requireDocumentCSP = /^(?:ftp|file):/.test(url);
      if (!requireDocumentCSP) {
        // CSP headers have been already provided by webRequest, we are not in a hurry...
        if (/^(javascript|about):/.test(url)) {
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

      // Here we've got no CSP header yet (file: or ftp: URL), we need one
      // injected in the DOM as soon as possible.
      debug("No CSP yet for non-HTTP document load: fetching policy synchronously...");
      documentCSP.removeEventAttributes();

      let earlyScripts = [];
      let dequeueEarlyScripts = (last = false) => {
        if (!(ns.canScript && earlyScripts)) return;
        if (earlyScripts.length === 0) {
          earlyScripts = null;
          return;
        }
        for (let s; s = earlyScripts.shift(); ) {
          debug("Restoring", s);
          s.firstChild._replaced = true;
          s._original.replaceWith(s);
        }
      }

      let syncFetch = callback => {
        browser.runtime.sendSyncMessage(
          {id: "fetchPolicy", url, contextUrl: url},
          callback);
      };

      if (UA.isMozilla && document.readyState !== "complete") {
        // Mozilla has already parsed the <head> element, we must take extra steps...

        debug("Early parsing: preemptively suppressing events and script execution.");

        {
          let eventTypes = [];
          for (let p in document.documentElement) if (p.startsWith("on")) eventTypes.push(p.substring(2));
          let eventSuppressor = e => {
            if (!ns.canScript) {
              e.stopImmediatePropagation();
              debug(`Suppressing ${e.type} on `, e.target); // DEV_ONLY
            }
          }
          debug("Starting event suppression");
          for (let et of eventTypes) document.addEventListener(et, eventSuppressor, true);

          ns.on("capabilities", () => {
            if (!ns.canScript) {
              try {
                for (node of document.querySelectorAll("*")) {
                  let evAttrs = [...node.attributes].filter(a => a.name.toLowerCase().startsWith("on"));
                  for (let a of evAttrs) {
                    debug("Reparsing event attribute after CSP", a, node);
                    node.removeAttributeNode(a);
                    node.setAttributeNodeNS(a);
                  }
                }
              } catch (e) {
                error(e);
              }
            }
            debug("Stopping event suppression");
            for (let et of eventTypes) document.removeEventListener(et, eventSuppressor, true);
          });
        }

        addEventListener("beforescriptexecute", e => {
          debug(e.type, e.target);
          if (earlyScripts) {
            let s = e.target;
            if (s._replaced) {
              debug("Replaced script found");
              dequeueEarlyScripts(true);
              return;
            }
            let replacement = document.createRange().createContextualFragment(s.outerHTML);
            replacement._original = s;
            s._replaced = true;
            earlyScripts.push(replacement);
            e.preventDefault();
            dequeueEarlyScripts(true);
            debug("Blocked early script");
          }
        }, true);
      }

      let setup = policy => {
        debug("Fetched %o, readyState %s", policy, document.readyState); // DEV_ONLY
        this.setup(policy);
        documentCSP.restoreEventAttributes();
      }

      for (let attempts = 3; attempts-- > 0;) {
        try {
          syncFetch(setup);
          break;
        } catch (e) {
          if (!Messages.isMissingEndpoint(e) || document.readyState === "complete") {
            error(e);
            break;
          }
          error("Background page not ready yet, retrying to fetch policy...")
        }
      }

      dequeueEarlyScripts();
    },

    setup(policy) {
      debug("%s, %s, %o", document.URL, document.readyState, policy);
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
        this.capabilities = new Set(perms.capabilities);
        documentCSP.apply(this.capabilities, this.embeddingDocument);
      }
      this.canScript = this.allows("script");
      this.fire("capabilities");
    },

    policy: null,

    allows(cap) {
      return this.capabilities && this.capabilities.has(cap);
    },
  };

  if (this.ns) {
    this.ns.merge(ns);
  } else {
    this.ns = ns;
  }
}
