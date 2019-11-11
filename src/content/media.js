if ("MediaSource" in window) {
  let notify = allowed => {
    let request = {
      id: "noscript-media",
      type: "media",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "media", request, allowed});
    debug("MSE notification", document.URL); // DEV_ONLY
    notifyPage();
    return request;
  };
  let createPlaceholder = (mediaElement, request) => {
    try {
      let ph = PlaceHolder.create("media", request);
      ph.replace(mediaElement);
      PlaceHolder.listen();
      debug("MSE placeholder for %o", mediaElement); // DEV_ONLY
    } catch (e) {
      error(e);
    }
  };

  if (typeof exportFunction === "function") {
    // Mozilla
    let mediablocker = true;
    ns.on("capabilities", e => {
      mediaBlocker = !ns.allows("media");
    });

    let unpatched = new Map();
    function patch(obj, methodName, replacement) {
       let methods = unpatched.get(obj) || {};
       methods[methodName] = obj[methodName];
       exportFunction(replacement, obj, {defineAs: methodName});
       unpatched.set(obj, methods);
    }
    let urlMap = new WeakMap();
    patch(window.URL, "createObjectURL",  function(o, ...args) {
      let url = unpatched.get(window.URL).createObjectURL.call(this, o, ...args);
      if (o instanceof MediaSource) {
        let urls = urlMap.get(o);
        if (!urls) urlMap.set(o, urls = new Set());
        urls.add(url);
      }
      return url;
    });

    patch(window.MediaSource.prototype, "addSourceBuffer", function(mime, ...args) {
      let ms = this;
      let urls = urlMap.get(ms);
      let request = notify(!mediaBlocker);
      if (mediaBlocker) {
        let exposedMime = `${mime} (MSE)`;
        setTimeout(() => {
          let me = Array.from(document.querySelectorAll("video,audio"))
            .find(e => e.srcObject === ms || urls && urls.has(e.src));
          if (me) createPlaceholder(me, request);
        }, 0);
        throw new Error(`${exposedMime} blocked by NoScript`);
      }

      return unpatched.get(window.MediaSource.prototype).addSourceBuffer.call(ms, mime, ...args);
    });

  } else if ("SecurityPolicyViolationEvent" in window) {
    // Chromium
    addEventListener("securitypolicyviolation", e => {
      if (!e.isTrusted || ns.allows("media")) return;
      let {blockedURI, violatedDirective} = e;
      if (blockedURI.startsWith("blob") && violatedDirective.startsWith("media-src")) {
        let request = notify(false);
        for (let me of document.querySelectorAll("video,audio")) {
          if (!(me.src || me.currentSrc) || me.src.startsWith("blob")) {
            createPlaceholder(me, request);
          }
        }
      }
    }, true);
  }
}
