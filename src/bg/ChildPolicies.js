"use strict";
{
  let marker = uuid();
  let allUrls = ["<all_urls>"];

  let Scripts = {
    references: new Set(),
    opts: {
      js: [{file: "/content/dynamicNS.js"}, {}],
      allFrames: true,
      matchAboutBlank: true,
      runAt: "document_start"
    },
    async init() {
      this.init = this.forget;
    },
    forget() {
      for (let script of [...this.references]) {
        script.unregister();
        this.references.delete(script);
      }
    },
    debug: false,
    trace(code) {
      return this.debug
        ? `console.debug("Executing child policy on %s", document.URL, ${JSON.stringify(code)});${code}`
        : code
        ;
    },
    async register(code, matches, excludeMatches) {
      debug("Registering child policy.", code, matches, excludeMatches);
      if (!matches.length) return;
      try {
        let opts = Object.assign({}, this.opts);
        opts.js[1].code = this.trace(code);
        opts.matches = matches;
        if (excludeMatches && excludeMatches.length) {
          opts.excludeMatches = excludeMatches;
        }
        this.references.add(await browser.contentScripts.register(opts));
      } catch (e) {
        error(e);
      }
    },

    buildPerms(perms) {
      if (typeof perms !== "string") {
        perms = JSON.stringify(perms);
      }
      return `ns.setup(${perms}, "${marker}");`
    }
  };

  let flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);

  let protocolRx = /^(\w+):/i;
  let portRx = /:\d+(?=\/|$)/;
  let validMatchPatternRx = /^(?:\*|(?:http|ws|ftp)s?|file):\/\/(?:\*|(?:\*\.)?[\w\u0100-\uf000][\w\u0100-\uf000.-]*|\[[\w:]+\])?\/(\*|[^*]*)$/;

  let validMatchPattern = mp => validMatchPatternRx.test(mp);

  let siteKey2MatchPattern = site => {
    let hasProtocol = site.match(protocolRx);
    let mp = site;
    if (hasProtocol) {
      mp = Sites.cleanUrl(mp);
      if (!mp) return false;
    } else {
      mp = Sites.isSecureDomainKey(site) ? "https://" : "*://";
      let hostname = Sites.toggleSecureDomainKey(site, false).replace(portRx, '');
      if (hostname && hostname !== ".") {
        if (tld.isIp(hostname) || hostname.includes("*")) {
          mp += hostname;
        } else {
          if (!tld.preserveFQDNs) hostname = tld.normalize(hostname);
          mp += hostname.startsWith(".") ? `*${hostname}` : `*.${hostname}`;
        }
      } else {
        mp += "*";
      }
      if (!(hostname && hostname.includes("/"))) mp += "/";
    }

    return validMatchPattern(mp) &&
      (mp.endsWith("/") ? `${mp}*` : [mp, `${mp}?*`, `${mp}#*`]);
  };

  let withFQDNs = patterns => {
    if (tld.preserveFQDNs) return patterns;
    let rx = /^(?:\w+|\*):\/\/([^/]*[^.*/])/;
    return patterns.concat(
      patterns.map(p => p.replace(rx, (m, host) => tld.isIp(host) ? m : m + ".")
        ).filter(validMatchPattern)
      );
  };

  let extraProtocols = patterns => patterns.concat(
      patterns.filter(p => p.startsWith("*://"))
        .map(p => p.replace("*", "ftp")));

  let siteKeys2MatchPatterns = keys =>
    keys ? [... new Set(
      extraProtocols(withFQDNs(flatten(keys.map(siteKey2MatchPattern)).filter(p => !!p))))]
      : [];

  var ChildPolicies = {
    addTabInfoCookie(request, info) {
      let {tabId, frameId} = request;
      let h = {
        name: "Set-Cookie",
        value: `${marker}_${tabId}_${frameId}=${JSON.stringify(info)}`
      };
      let {responseHeaders} = request;
      if (responseHeaders.some(({value, name}) => h.value === value && h.name === name)) {
       return false;
      }
      responseHeaders.push(h);
      return true;
    },
    async update(policy, tracing) {
      if (tracing !== "undefined") Scripts.debug = tracing;
      let t0 = Date.now();
      await Scripts.init();

      if (!policy.enforced) {
        await Scripts.register(Scripts.buildPerms("null"), allUrls);
        return;
      }

      let serialized = policy.dry ? policy.dry(true) : policy;
      let permsMap = new Map();
      let trusted = JSON.stringify(serialized.TRUSTED);
      let untrusted = JSON.stringify(serialized.UNTRUSTED);
      let presets = {
        trusted,
        untrusted,
        temp: trusted
      };
      // map presets to site keys
      for (let [container, perms] of Object.entries(presets)) {
        let newKeys = serialized.sites[container];
        if (!(newKeys && newKeys.length)) continue;
        let keys = permsMap.get(perms);
        if (keys) {
          newKeys = keys.concat(newKeys);
        }
        permsMap.set(perms, newKeys);
      }
      // map custom permissions to site keys
      for (let [key, perms] of Object.entries(serialized.sites.custom)) {
        let permsKey = JSON.stringify(perms);
        let keys = permsMap.get(permsKey);
        if (keys) {
          keys.push(key);
        } else {
          permsMap.set(permsKey, [key]);
        }
      }

      // compute exclusions
      let permsMapEntries = [...permsMap];
      let excludeMap = new Map();

      for (let [perms, keys] of permsMapEntries) {
        excludeMap.set(perms, siteKeys2MatchPatterns(flatten(
          permsMapEntries.filter(([other]) => other !== perms)
            .map(([otherPerms, otherKeys]) => otherKeys))
              .filter(k => k && k.includes("/") && keys.some(by => Sites.isImplied(k, by)))
          ));
      }

      // register new content scripts
      let registering = [];
      let allMatching = [];
      for (let [perms, keys] of [...permsMap]) {
        let match = siteKeys2MatchPatterns(keys);
        allMatching.push(...match);
        registering.push(Scripts.register(Scripts.buildPerms(perms), match, excludeMap.get(perms)));
      }
      registering.push(Scripts.register(Scripts.buildPerms(serialized.DEFAULT), allUrls, allMatching));
      await Promise.all(registering);
      if (tracing) {
        debug("All the child policies registered in %sms", Date.now() - t0);
      }
    },

    getForDocument(policy, url, context = null) {
      return {
        permissions: policy.get(url, context).perms.dry(),
        MARKER: marker
      };
    },

  };
}
