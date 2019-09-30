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
      let tabRemovalListener = null;
      let CANCEL = {cancel: true};
      let {TAB_ID_NONE} = browser.tabs;


      let obrListener = request => {
        let {url, tabId} = request;
        let params = new URLSearchParams(url.split("?")[1]);
        let msgId = params.get("id");
        let msg = params.get("msg");
        let documentUrl = params.get("url");
        let sender;
        if (tabId === TAB_ID_NONE) {
          // Firefox sends privileged content script XHR without valid tab ids
          // so we cache sender info from unprivileged XHR correlated by msgId
          if (pending.has(msgId)) {
            sender = pending.get(msgId);
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
            console.error(e, "Processing message %o from %o", msg, sender);
          }
        }
        return {
          redirectUrl: `data:application/json,${JSON.stringify(result)}`
        };
      };

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
    if (typeof uuid !== "function") {
      let uuid = () => (Math.random() * Date.now()).toString(16);
    }
    let docUrl = document.URL;
    browser.runtime.sendSyncMessage = sendSyncMessage = msg => {
      let msgId = `${uuid()},${docUrl}`;
      let url = `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
        `&url=${encodeURIComponent(docUrl)}`;
      if (window.top === window) {
        // we add top URL information because Chromium doesn't know anything
        // about frameAncestors
        url += "&top=true";
      }

      if (MOZILLA) {
        // on Firefox we first need to send an async message telling the
        // background script about the tab ID, which does not get sent
        // with "privileged" XHR
        browser.runtime.sendMessage({___syncMessageId: msgId});
      }
      // adding the payload
      url += `&msg=${encodeURIComponent(JSON.stringify(msg))}`;
      try {
        // then we send the payload using a privileged XHR, which is not subject
        // to CORS but unfortunately doesn't carry any tab id except on Chromium
        let r = new XMLHttpRequest();
        r.open("GET", url, false);
        r.send(null);
        return JSON.parse(r.responseText);
      } catch(e) {
        console.error(`syncMessage error in ${document.URL}: ${e.message}`);
      }
      return null;
    };
  }
})();
