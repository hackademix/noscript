"use strict";
{
  let marker = JSON.stringify(uuid());
  let allUrls = ["<all_urls>"];

  let Scripts = {
    references: new Set(),
    opts: {
      js: [{}],
      allFrames: true,
      matchAboutBlank: true,
      runAt: "document_start"
    },
    async init() {
      let opts = Object.assign({}, this.opts);
      opts.js = [{file: "/content/dynamicNS.js"}];
      opts.matches = allUrls;
      delete opts.excludedMatches;
      this._stubScript = await browser.contentScripts.register(opts);

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
        opts.js[0].code = this.trace(code);
        opts.matches = matches;
        if (excludeMatches && excludeMatches.length) {
          opts.excludeMatches = excludeMatches;
        }
        this.references.add(await browser.contentScripts.register(opts));
      } catch (e) {
        error(e);
      }
    },

    buildPerms(perms, finalizeSetup = false) {
      if (typeof perms !== "string") {
        perms = JSON.stringify(perms);
      }
      return finalizeSetup
        ? `ns.setup(${perms}, ${marker});`
        : `ns.config.CURRENT = ${perms};`
        ;
    }
  };

  let flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);

  let protocolRx = /^(\w+):/i;
  let pathRx = /(?:[^:/]\/|:\/{3})$/;
  let portRx = /:\d+(?=\/|$)/;
  let validMatchPatternRx = /^(?:\*|(?:http|ws|ftp)s?|file):\/\/(?:\*\.)?(?:[\w\u0100-\uf000][\w\u0100-\uf000.-]*)?\/(\*|[^*]*)$/;

  let siteKey2MatchPattern = site => {
    let hasProtocol = site.match(protocolRx);
    let mp = site;
    if (hasProtocol) {
      mp = Sites.cleanUrl(mp);
      if (!mp) return false;
    } else {
      let protocol = Sites.isSecureDomainKey(site) ? "https://" : "*://";
      let hostname = Sites.toggleSecureDomainKey(site, false).replace(portRx, '');
      if (!tld.preserveFQDNs) hostname = tld.normalize(hostname);
      mp = `${protocol}*.${hostname}`;
      if (!hostname.includes("/")) mp += "/";
    }

    return validMatchPatternRx.test(mp) && (
      mp.endsWith("/") ? `${mp}*` : [mp, `${mp}?*`, `${mp}#*`]);
  };

  let withFQDNs = patterns => {
    return tld.preserveFQDNs ? patterns : patterns.concat(
      patterns.map(p => p.replace(/^(?:\w+|\*):\/\/[^/]*[^./]/, '$&.'))
    );
  }

  let siteKeys2MatchPatterns = keys =>
    keys && withFQDNs(flatten(keys.map(siteKey2MatchPattern))
      .filter(p => !!p))
      || [];

  var ChildPolicies = {
    async storeTabInfo(tabId, info) {
      try {
        let preamble = info ? `${marker} + ${JSON.stringify(JSON.stringify([info]))} + ${marker} + "," + ` : "";
        await browser.tabs.executeScript(tabId, {
          code: `window.name = ${preamble}window.name.split(${marker} + ",").pop();`,
          allFrames: true,
          matchAboutBlank: true,
          runAt: "document_start",
        });
      } catch (e) {
        error(e);
      }
    },
    async update(policy, debug) {
      if (debug !== "undefined") Scripts.debug = debug;

      await Scripts.init();

      if (!policy.enforced) {
        await Scripts.register(`ns.setup(null, ${marker});`, allUrls);
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
      for (let [perms, keys] of [...permsMap]) {
        await Scripts.register(Scripts.buildPerms(perms), siteKeys2MatchPatterns(keys), excludeMap.get(perms));
      }
      await Scripts.register(Scripts.buildPerms(serialized.DEFAULT, true), allUrls);
    },

    getForDocument(policy, url, context = null) {
      return {
        CURRENT: policy.get(url, context).perms.dry(),
        DEFAULT: policy.DEFAULT.dry(),
        MARKER: marker
      };
    },

    async updateFrame(tabId, frameId, perms, defaultPreset) {
      let code = Scripts.buildPerms(perms) + Scripts.buildPerms(defaultPreset, true);
      await browser.tabs.executeScript(tabId, {
        code,
        frameId,
        matchAboutBlank: true,
        runAt: "document_start"
      });
    }
  };
}
