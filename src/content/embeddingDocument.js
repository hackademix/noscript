if (ns.embeddingDocument) {
  ns.on("capabilities", () => {
    for (let policyType of ["object", "media"]) {
      if (!ns.allows(policyType)) {
        let request = {
          id: `noscript-${policyType}-doc`,
          type: policyType,
          url: document.URL,
          documentUrl: document.URL,
          embeddingDocument: true,
        };
        let ph = PlaceHolder.create(policyType, request);
        if (ph.replacements.size > 0) {
          debug(`Created placeholder for ${policyType} at ${document.URL}`);
          seen.record({policyType, request, allowed: false});
        }
      }
    }
  });
}
