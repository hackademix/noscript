"use strict";
(() => {
  let ENDPOINT_PREFIX = `https://sync-messages.invalid/${browser.extension.getURL("")}?`;
  let MOZILLA = "mozSystem" in XMLHttpRequest.prototype;

  if (browser.webRequest) {
    if (typeof browser.runtime.onSyncMessage !== "object") {
      // Background Script side

      // cache of senders from early async messages to track tab ids in Firefox
      let pending = new Map();
      if (MOZILLA) {
        // we don't care this is async, as long as it get called before the
        // sync XHR (we are not interested in the response on the content side)
        browser.runtime.onMessage.addListener((m, sender) => {
          if (!m.___syncMessageId) return;
          pending.set(m.___syncMessageId, sender);
        });
      }

      let tabUrlCache = new Map();
      let asyncResults = new Map();
      let tabRemovalListener = null;
      let CANCEL = {cancel: true};
      let {TAB_ID_NONE} = browser.tabs;


      let obrListener = request => {
        let {url, tabId} = request;
        let params = new URLSearchParams(url.split("?")[1]);
        let msgId = params.get("id");
        if (asyncResults.has(msgId)) {
          return asyncRet(msgId);
        }
        let msg = params.get("msg");
        let documentUrl = params.get("url");
        let suspension = !!params.get("suspend");
        let sender;
        if (tabId === TAB_ID_NONE || suspension) {
          // Firefox sends privileged content script XHR without valid tab ids
          // so we cache sender info from unprivileged XHR correlated by msgId
          if (pending.has(msgId)) {
            sender = pending.get(msgId);
            if (suspension) { // we hold any script execution / DOM modification on this promise
              return new Promise(resolve => {
                sender.unsuspend = resolve;
              });
            }
            if (sender.unsuspend) {
              let {unsuspend} = sender;
              delete sender.unsuspend;
              setTimeout(unsuspend(ret("unsuspend")), 0);
            }
            pending.delete(msgId);
          } else {
            throw new Error(`sendSyncMessage: cannot correlate sender info for ${msgId}.`);
          }
        } else {
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
          sender = {
            tab: {
              id: tabId,
              url: tabUrl
            },
            frameId,
            url: documentUrl,
            timeStamp: Date.now()
          };
        }
        if (!(msg !== null && sender)) {
          return CANCEL;
        }
        // Just like in the async runtime.sendMessage() API,
        // we process the listeners in order until we find a not undefined
        // result, then we return it (or undefined if none returns anything).
        let result;
        for (let l of listeners) {
          try {
            if ((result = l(JSON.parse(msg), sender)) !== undefined) break;
          } catch (e) {
            console.error("%o processing message %o from %o", e, msg, sender);
          }
        }
        if (result instanceof Promise) {
          if (MOZILLA) {
            // Firefox supports asynchronous webRequest listeners, so we can
            // just defer the return
            return (async () => ret(await result))();
          } else {
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
        }
        return ret(result);
      };

      let ret = r => ({redirectUrl:  `data:application/json,${JSON.stringify(r)}`})
      let asyncRet = msgId => {
        let result = asyncResults.get(msgId);
        asyncResults.delete(msgId);
        return ret(result);
      }

      let listeners = new Set();
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
    browser.runtime.sendSyncMessage = msg => {
      let msgId = `${uuid()},${docUrl}`;
      let url = `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
        `&url=${encodeURIComponent(docUrl)}`;
      if (window.top === window) {
        // we add top URL information because Chromium doesn't know anything
        // about frameAncestors
        url += "&top=true";
      }
      let finalizers = [];
      if (MOZILLA) {
        // on Firefox we first need to send an async message telling the
        // background script about the tab ID, which does not get sent
        // with "privileged" XHR
        browser.runtime.sendMessage({___syncMessageId: msgId});

        // In order to cope with inconsistencies in XHR synchronicity,
        // allowing DOM element to be inserted and script to be executed
        // (seen with file:// and ftp:// loads) we additionally suspend on
        // Mutation notifications and beforescriptexecute events
        let suspendURL = url + "&suspend";
        let suspend = () => {
          let r = new XMLHttpRequest();
          r.open("GET", url, false);
          r.send(null);
        };
        let domSuspender = new MutationObserver(suspend);
        domSuspender.observe(document.documentElement, {childList: true});
        addEventListener("beforescriptexecute", suspend, true);
        finalizers.push(() => {
          removeEventListener("beforescriptexecute", suspend, true);
          domSuspender.disconnect();
        });
      }
      // then we send the payload using a privileged XHR, which is not subject
      // to CORS but unfortunately doesn't carry any tab id except on Chromium

      url += `&msg=${encodeURIComponent(JSON.stringify(msg))}`; // adding the payload
      let r = new XMLHttpRequest();
      try {
        r.open("GET", url, false);
        r.send(null);
        return JSON.parse(r.responseText);
      } catch(e) {
        console.error(`syncMessage error in ${document.URL}: ${e.message} (response ${r.responseText})`);
      } finally {
        for (let f of finalizers) try { f(); } catch(e) { console.error(e); }
      }
      return null;
    };
  }
})();
