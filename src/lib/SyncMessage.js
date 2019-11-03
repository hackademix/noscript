"use strict";
(() => {
  let ENDPOINT_PREFIX = `https://sync-messages.invalid/${browser.extension.getURL("")}?`;
  let MOZILLA = "mozSystem" in XMLHttpRequest.prototype;

  if (browser.webRequest) {
    if (typeof browser.runtime.onSyncMessage !== "object") {
      // Background Script side

      let pending = new Map();
      if (MOZILLA) {
        // we don't care this is async, as long as it get called before the
        // sync XHR (we are not interested in the response on the content side)
        browser.runtime.onMessage.addListener((m, sender) => {
          let wrapper = m.__syncMessage__;
          if (!wrapper) return;
          let {id} = wrapper;
          pending.set(id, wrapper);
          let result;
          let unsuspend = result => {
            pending.delete(id);
            if (wrapper.unsuspend) {
              setTimeout(wrapper.unsuspend, 0);
            }
            return result;
          }
          try {
            result = notifyListeners(JSON.stringify(wrapper.payload), sender);
          } catch(e) {
            unsuspend();
            throw e;
          }
          console.debug("sendSyncMessage: returning", result);
          return (result instanceof Promise ? result
            : new Promise(resolve => resolve(result))
          ).then(result => unsuspend(result));
        });
      }

      let tabUrlCache = new Map();
      let asyncResults = new Map();
      let tabRemovalListener = null;
      let CANCEL = {cancel: true};
      let {TAB_ID_NONE} = browser.tabs;


      let obrListener = request => {
        try {
        let {url, tabId} = request;
        let params = new URLSearchParams(url.split("?")[1]);
        let msgId = params.get("id");
        if (asyncResults.has(msgId)) {
          return asyncRet(msgId);
        }
        let msg = params.get("msg");

        if (MOZILLA || tabId === TAB_ID_NONE) {
          // this shoud be a mozilla suspension request
          return params.get("suspend") ? new Promise(resolve => {
            if (pending.has(msgId)) {
              let wrapper = pending.get(msgId);
              if (!wrapper.unsuspend) {
                wrapper.unsuspend = resolve;
                return;
              }
            }
            resolve();
          }).then(() => ret("go on"))
          : CANCEL; // otherwise, bail
        }
        // CHROME from now on
        let documentUrl = params.get("url");
        let {frameAncestors, frameId} = request;
        let isTop = frameId === 0 || !!params.get("top");
        let tabUrl = frameAncestors && frameAncestors.length
          && frameAncestors[frameAncestors.length - 1].url;

        if (!tabUrl) {
          if (isTop) {
            tabUrlCache.set(tabId, tabUrl = documentUrl);
            if (!tabRemovalListener) {
              browser.tabs.onRemoved.addListener(tabRemovalListener = tab => {
                tabUrlCache.delete(tab.id);
              });
            }
          } else {
            tabUrl = tabUrlCache.get(tabId);
          }
        }
        let sender = {
          tab: {
            id: tabId,
            url: tabUrl
          },
          frameId,
          url: documentUrl,
          timeStamp: Date.now()
        };

        if (!(msg !== null && sender)) {
          return CANCEL;
        }
        let result = notifyListeners(msg, sender);
        if (result instanceof Promise) {

          // On Chromium, if the promise is not resolved yet,
          // we redirect the XHR to the same URL (hence same msgId)
          // while the result get cached for asynchronous retrieval
          result.then(r => {
            asyncResults.set(msgId, result = r);
          });
          return asyncResults.has(msgId)
          ? asyncRet(msgId) // promise was already resolved
          : {redirectUrl: url.replace(
              /&redirects=(\d+)|$/, // redirects count to avoid loop detection
              (all, count) => `&redirects=${parseInt(count) + 1 || 1}`)};
        }
        return ret(result);
      } catch(e) {
        console.error(e);
        return CANCEL;
      } };

      let ret = r => ({redirectUrl:  `data:application/json,${JSON.stringify(r)}`})
      let asyncRet = msgId => {
        let result = asyncResults.get(msgId);
        asyncResults.delete(msgId);
        return ret(result);
      }

      let listeners = new Set();
      function notifyListeners(msg, sender) {
        // Just like in the async runtime.sendMessage() API,
        // we process the listeners in order until we find a not undefined
        // result, then we return it (or undefined if none returns anything).
        for (let l of listeners) {
          try {
            let result = l(JSON.parse(msg), sender);
            if (result !== undefined) return result;
          } catch (e) {
            console.error("%o processing message %o from %o", e, msg, sender);
          }
        }
      }
      browser.runtime.onSyncMessage = {
        ENDPOINT_PREFIX,
        addListener(l) {
          listeners.add(l);
          if (listeners.size === 1) {
            browser.webRequest.onBeforeRequest.addListener(obrListener,
              {urls: [`${ENDPOINT_PREFIX}*`],
                types: ["xmlhttprequest"]},
              ["blocking"]
            );
          }
        },
        removeListener(l) {
          listeners.remove(l);
          if (listeners.size === 0) {
            browser.webRequest.onBeforeRequest.removeListener(obrListener);
          }
        },
        hasListener(l) {
          return listeners.has(l);
        }
      };
    }
  } else if (typeof browser.runtime.sendSyncMessage !== "function") {
    // Content Script side
    let uuid = () => (Math.random() * Date.now()).toString(16);
    let docUrl = document.URL;
    browser.runtime.sendSyncMessage = (msg, callback) => {
      let msgId = `${uuid()},${docUrl}`;
      let url = `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
        `&url=${encodeURIComponent(docUrl)}`;
      if (window.top === window) {
        // we add top URL information because Chromium doesn't know anything
        // about frameAncestors
        url += "&top=true";
      }
      /*
      if (document.documentElement instanceof HTMLElement && !document.head) {
        // let's insert a head element to let userscripts work
        document.documentElement.appendChild(document.createElement("head"));
      }*/

      if (MOZILLA) {
        // on Firefox we first need to send an async message telling the
        // background script about the tab ID, which does not get sent
        // with "privileged" XHR
        let result;
        browser.runtime.sendMessage(
          {__syncMessage__: {id: msgId, payload: msg}}
        ).then(r => {
          result = r;
          if (callback) callback(r);
        }).catch(e => {
          throw e;
        });

        // In order to cope with inconsistencies in XHR synchronicity,
        // allowing DOM element to be inserted and script to be executed
        // (seen with file:// and ftp:// loads) we additionally suspend on
        // Mutation notifications and beforescriptexecute events
        let suspendURL = url + "&suspend=true";
        let suspended = false;
        let suspend = () => {
          if (suspended) return;
          suspended = true;
          try {
            let r = new XMLHttpRequest();
            r.open("GET", suspendURL, false);
            r.send(null);
          } catch (e) {
            console.error(e);
          }
          suspended = false;
        };
        let domSuspender = new MutationObserver(records => {
          suspend();
        });
        domSuspender.observe(document.documentElement, {childList: true});
        addEventListener("beforescriptexecute", suspend, true);

        let finalize = () => {
          removeEventListener("beforescriptexecute", suspend, true);
          domSuspender.disconnect();
        };

        if (callback) {
          let realCB = callback;
          callback = r => {
            try {
              realCB(r);
            } finally {
              finalize();
            }
          };
          return;
        }
        try {
          suspend();
        } finally {
          finalize();
        }
        return result;
      }
      // then we send the payload using a privileged XHR, which is not subject
      // to CORS but unfortunately doesn't carry any tab id except on Chromium

      url += `&msg=${encodeURIComponent(JSON.stringify(msg))}`; // adding the payload
      let r = new XMLHttpRequest();
      let result;
      try {
        r.open("GET", url, false);
        r.send(null);
        result = JSON.parse(r.responseText);
      } catch(e) {
        console.error(`syncMessage error in ${document.URL}: ${e.message} (response ${r.responseText})`);
      }
      if (callback) callback(result);
      return result;
    };
  }
})();
