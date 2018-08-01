{
  debug("WebGL Hook", document.URL, document.documentElement && document.documentElement.innerHTML); // DEV_ONLY
  let proto = HTMLCanvasElement.prototype;
  let getContext = proto.getContext;
  exportFunction(function(type, ...rest) {
    if (type && type.toLowerCase().includes("webgl")) {
      let request = {
        id: "noscript-webgl",
        type: "webgl",
        url: document.URL,
        documentUrl: document.URL,
        embeddingDocument: true,
      };
      seen.record({policyType: "webgl", request, allowed: false});
      try {
        let ph = PlaceHolder.create("webgl", request);
        ph.replace(this);
        PlaceHolder.listen();
      } catch (e) {
        error(e);
      }
      notifyPage();
      return {};
    }
    return getContext.call(this, type, ...rest);
  }, proto, {defineAs: "getContext"});
  document.URL;
}
