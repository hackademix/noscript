"use strict";
{
  let marker = JSON.stringify(uuid());
  
  let Scripts = {
    references: new Set(),
    opts: {
      js: [{}],
      allFrames: true,
      matchAboutBlank: true,
      runAt: "document_start"
    },
    forget() {
      for (let script of [...this.references]) {
        script.unregister();
        this.references.delete(script);
      }
    },
    async register(code, matches, excludeMatches) {
      debug("Registering child policy.", code, matches, excludeMatches);
      if (!matches.length) return;
      try {
        this.opts.js[0].code = code;
        this.opts.matches = matches;
        if (excludeMatches && excludeMatches.length) {
          this.opts.excludeMatches = excludeMatches;
        } else {
          delete this.opts.excludeMatches;
        }
        this.references.add(await browser.contentScripts.register(this.opts));
      } catch (e) {
        error(e);
      }
    }
  };
  
  let flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
  
  let protocolRx = /^(https?):/i;
  let pathRx = /[^:/]\//;
  let portRx = /:\d+(?=\/|$)/;
  let validMatchPatternRx = /^(?:https?|\*):\/\/(?:\*\.)?(?:[\w\u0100-\uf000][\w\u0100-\uf000.-]*)?[\w\u0100-\uf000]\/(\*|[^*]*)$/;
  
  let siteKey2MatchPattern = site => {
    let hasProtocol = site.match(protocolRx);
    let protocol = hasProtocol ? ''
      : Sites.isSecureDomainKey(site) ? "https://" : "*://";
    let hostname = Sites.toggleSecureDomainKey(site, false)
      .replace(portRx, '');
    if (!hasProtocol) hostname = `*.${hostname}`;
    let path = pathRx.test(hostname) ? "" : "/*";
    let mp = `${protocol}${hostname}${path}`;
    return  validMatchPatternRx.test(mp) && (path ? mp : [mp, `${mp}?*`, `${mp}#*`]);
  };
  
  let siteKeys2MatchPatterns = keys => keys && flatten(keys.map(siteKey2MatchPattern)).filter(p => !!p) || [];  

  var ChildPolicies = {
    async storeTabInfo(tabId, info) {
      try {
        await browser.tabs.executeScript(tabId, {
          code: `window.name = ${marker} + ${JSON.stringify(JSON.stringify([info]))} + ${marker} + "," + window.name;`,
          allFrames: false,
          matchAboutBlank: true,
          runAt: "document_start",
        });    
      } catch (e) {
        error(e);
      }
    },
    async update(policy) {
      Scripts.forget();
      
      if (!policy.enforced) {
        await Scripts.register(`ns.setup(null, ${marker});`, 
           ["<all_urls>"]);
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
              .filter(k => k && k.includes("/"))
          ));
      }
      
      // register new content scripts
      for (let [perms, keys] of [...permsMap]) {
        await Scripts.register(`ns.perms.CURRENT = ${perms};`, siteKeys2MatchPatterns(keys), excludeMap.get(perms));
      }
      await Scripts.register(`ns.setup(${JSON.stringify(serialized.DEFAULT)}, ${marker});`, 
         ["<all_urls>"]);
    }
  }
}
