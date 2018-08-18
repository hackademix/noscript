var ContentScriptOnce = (() => {
  "use strict";
  
  let requestMap = new Map();
  
  {
    let cleanup = r => {
      let {requestId} = r;
      let scripts = requestMap.get(requestId);
      if (scripts) {
        window.setTimeout(() => {
          requestMap.delete(requestId);
          for (let s of scripts) s.unregister();
        }, 0);
      }
    }
    
    let filter = {
      urls: ["<all_urls>"],
      types:  ["main_frame", "sub_frame", "object"]
    };
    let wr = browser.webRequest;
    for (let event of ["onCompleted", "onErrorOccurred"]) {
      wr[event].addListener(cleanup, filter);
    }
  }
  
  return {
    async execute(request, options) {
      let {requestId, url} = request; 
      let scripts = requestMap.get(requestId);
      if (!scripts) requestMap.set(requestId, scripts = new Set());
      try {
        let urlObj = new URL(url);
        if (urlObj.port) {
          urlObj.port = "";
          url = urlObj.toString();
        }
      } catch (e) {}
      let defOpts = {
        runAt: "document_start",
        matchAboutBlank: true,
        matches: [url],
        allFrames: true,
      };
      
      scripts.add(await browser.contentScripts.register(
        Object.assign(defOpts, options)
      ));
    }
  }
})();
