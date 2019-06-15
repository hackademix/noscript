if (ns.embeddingDocument) {
  let replace = () => {
    for (let policyType of ["object", "media"]) {
      let request = {
        id: `noscript-${policyType}-doc`,
        type: policyType,
        url: document.URL,
        documentUrl: document.URL,
        embeddingDocument: true,
      };

      if (ns.allows(policyType)) {
        let handler = PlaceHolder.handlerFor(policyType);
        if (handler && handler.selectFor(request).length > 0) {
          seen.record({policyType, request, allowed: true});
        }
      } else {
        let ph = PlaceHolder.create(policyType, request);
        if (ph.replacements.size > 0) {
          debug(`Created placeholder for ${policyType} at ${document.URL}`);
          seen.record({policyType, request, allowed: false});
        }
      }
    }
  };
  ns.on("capabilities", () => {
    if (!document.body.firstChild) { // we've been called early
      setTimeout(replace, 0);
      let types = {
        "media": /^(?:video|audio)\//i,
        "object": /^application\//i,
      }
      for (let [type, rx] of Object.entries(types)) {
        if (rx.test(document.contentType) && !ns.allows(type)) {
          window.stop();
          break;
        }
      }

    } else {
      replace();
    }
  });
}
