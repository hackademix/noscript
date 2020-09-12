if ("MediaSource" in window) {
  let mediaBlocker;
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
  if ("SecurityPolicyViolationEvent" in window) {
    // "Modern" browsers
    let createPlaceholders = () => {
      let request = notify(false);
      for (let me of document.querySelectorAll("video,audio")) {
        if (!(me.src || me.currentSrc) || me.src.startsWith("blob")) {
          createPlaceholder(me, request);
        }
      }
    }
    let processedURIs = new Set();
    addEventListener("securitypolicyviolation", e => {
      let {blockedURI, violatedDirective} = e;
      if (!(e.isTrusted && violatedDirective.startsWith("media-src"))) return;
      if (mediaBlocker === undefined && /^data\b/.test(blockedURI)) { // Firefox 81 reports just "data"
        debug("mediaBlocker set via CSP listener.")
        mediaBlocker = true;
        e.stopImmediatePropagation();
        return;
      }
      if (blockedURI.startsWith("blob") &&
          !processedURIs.has(blockedURI)) {
        processedURIs.add(blockedURI);
        setTimeout(createPlaceholders, 0);
      }
    }, true);
  }

  if (typeof exportFunction === "function") {
    // Fallback: Mozilla does not seem to trigger CSP media-src http: for blob: URIs assigned in MSE
    window.wrappedJSObject.document.createElement("video").src = "data:"; // triggers early mediaBlocker initialization via CSP
    ns.on("capabilities", e => {
      mediaBlocker = !ns.allows("media");
      if (mediaBlocker) debug("mediaBlocker set via fetched policy.")
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
          try {
            let allMedia = [...document.querySelectorAll("video,audio")];
            let me = allMedia.find(e => e.srcObject === ms ||
              urls && (urls.has(e.currentSrc) || urls.has(e.src))) ||
              // throwing may cause src not to be assigned at all:
              allMedia.find(e => !(e.src || e.currentSrc || e.srcObject));
            if (me) createPlaceholder(me, request);
          } catch (e) {
            error(e);
          }
        }, 0);
        let msg = `${exposedMime} blocked by NoScript`;
        log(msg);
        throw new Error(msg);
      }

      return unpatched.get(window.MediaSource.prototype).addSourceBuffer.call(ms, mime, ...args);
    });
  }
}
