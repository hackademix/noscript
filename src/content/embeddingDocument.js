if (ns.embeddingDocument) {
  let suspended;
  let suspender = new MutationObserver(records => {
    if (suspended) return;
    suspended = document.body.firstElementChild;
    if (suspended) {
      debug("Suspending ", suspended.src, suspended);
      suspended.autoplay = false;
      suspended.src = "data:";
      suspender.disconnect();
    }
  });
  suspender.observe(document, {childList: true, subtree: true});

  let replace = () => {
    if (suspended) {
      suspended.src = document.URL;
      suspended.autoplay = true;
    } else {
      suspender.disconnect();
    }
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
    if (!(document.body && document.body.firstChild)) { // we've been called early
      setTimeout(replace, 0);
      let types = {
        // Reminder: order is important because media matches also for
        // some /^application\// types
        "media": /^(?:(?:video|audio)\/|application\/(?:ogg|mp4|mpeg)$)/i,
        "object": /^application\//i,
      }
      for (let [type, rx] of Object.entries(types)) {
        if (rx.test(document.contentType)) {
          if (!ns.allows(type)) {
            window.stop();
          }
          break;
        }
      }
    } else {
      replace();
    }
  });
}
