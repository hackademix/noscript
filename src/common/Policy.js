var {Permissions, Policy, Sites} = (() => {
  'use strict';
  const SECURE_DOMAIN_PREFIX = "§:";
  const SECURE_DOMAIN_RX = new RegExp(`^${SECURE_DOMAIN_PREFIX}`);
  const DOMAIN_RX = new RegExp(`(?:^\\w+://|${SECURE_DOMAIN_PREFIX})?([^/]*)`, "i");
  const IPV4_RX = /^(?:\d+\.){1,3}\d+/;
  const INTERNAL_SITE_RX = /^(?:(?:about|chrome|resource|(?:moz|chrome)-.*):|\[System)/;
  const VALID_SITE_RX = /^(?:(?:(?:(?:http|ftp|ws)s?|file):)(?:(?:\/\/)[\w\u0100-\uf000][\w\u0100-\uf000.-]*[\w\u0100-\uf000.](?:$|\/))?|[\w\u0100-\uf000][\w\u0100-\uf000.-]*[\w\u0100-\uf000]$)/;

  let rxQuote = s => s.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");

  class Sites extends Map {
    static secureDomainKey(domain) {
      return /^[§\w]+:/.test(domain) ? domain : `${SECURE_DOMAIN_PREFIX}${domain}`;
    }
    static isSecureDomainKey(domain) {
      return domain.startsWith(SECURE_DOMAIN_PREFIX);
    }
    static toggleSecureDomainKey(domain, b = !Sites.isSecureDomainKey(domain)) {
      return b ? Sites.secureDomainKey(domain) : domain.replace(SECURE_DOMAIN_RX, '');
    }

    static isValid(site) {
      return VALID_SITE_RX.test(site);
    }

    static isInternal(site) {
      return INTERNAL_SITE_RX.test(site);
    }

    static originImplies(originKey, site) {
      return originKey === site || site.startsWith(`${originKey}/`);
    }

    static domainImplies(domainKey, site, protocol ="https?") {
      if (Sites.isSecureDomainKey(domainKey)) {
        protocol = "https";
        domainKey = Sites.toggleSecureDomainKey(domainKey, false);
      }
      if (!site.includes(domainKey)) return false;
      try {
        return new RegExp(`^${protocol}://([^/?#:]+\\.)?${rxQuote(domainKey)}(?:[:/]|$)`)
          .test(site);
      } catch (e) {
        error(e, `Cannot check if ${domainKey} implies ${site}`);
        return false;
      }
    }

    static isImplied(site, byKey) {
      return byKey.includes("://")
        ? Sites.originImplies(byKey, site)
        : Sites.domainImplies(byKey, site);
    }

    static parse(site) {
      let url, siteKey = "";
      if (site instanceof URL) {
        url = site;
      } else {
        try {
          url = new URL(site);
        } catch (e) {
          siteKey = site ? (typeof site === "string" ? site : site.toString()) : "";
        }
      }
      if (url) {
        if (Sites.onionSecure && url.protocol === "http:" && url.hostname.endsWith(".onion")) {
          url.protocol = "https:";
        }
        let path = url.pathname;
        siteKey = url.origin;
        if (siteKey === "null") {
          siteKey = site;
        } else if (path !== '/') {
          siteKey += path;
        }
      }
      return {url, siteKey};
    }

    static optimalKey(site) {
      let {url, siteKey} = Sites.parse(site);
      if (url && url.protocol === "https:") return Sites.secureDomainKey(tld.getDomain(url.hostname));
      return Sites.origin(url) || siteKey;
    }

    static origin(site) {
      if (!site) return "";
      try {
        let objUrl = (typeof site === "object" && "origin" in site) ? site : site.startsWith("chrome:") ? {origin: "chrome:" } : new URL(site);
        let {origin} = objUrl;
        return origin === "null" ? Sites.cleanUrl(objUrl) || site : origin;
      } catch (e) {
        error(e);
      };
      return site.origin || site;
    }

    static cleanUrl(url) {
      try {
        url = new URL(url);
        if (!tld.preserveFQDNs && url.hostname) {
          url.hostname = tld.normalize(url.hostname);
        }
        url.port = "";
        url.search = "";
        url.hash = "";
        return url.href;
      } catch (e) {
        return null;
      }
    }

    static toExternal(url) { // domains are stored in punycode internally
      let s = typeof url === "string" ? url : url && url.toString() || "";
      if (s.startsWith(SECURE_DOMAIN_PREFIX)) s = s.substring(SECURE_DOMAIN_PREFIX.length);
      let [,domain] = DOMAIN_RX.exec(s);
      return domain.startsWith("xn--") ?
        s.replace(domain, punycode.toUnicode(domain))
        : s;
    }

    set(k, v) {
      if (!k || Sites.isInternal(k) || k === "§:") return this;
      let [,domain] = DOMAIN_RX.exec(k);
      if (/[^\u0000-\u007f]/.test(domain)) {
        k = k.replace(domain, punycode.toASCII(domain));
      }
      return super.set(k, v);
    }

    match(site) {
      if (site && this.size) {
        if (site instanceof URL) site = site.href;
        if (this.has(site)) return site;

        let {url, siteKey} = Sites.parse(site);

        if (site !== siteKey && this.has(siteKey)) {
          return siteKey;
        }

        if (url) {
          let {origin} = url;
          if (origin && origin !== "null" && origin < siteKey && this.has(origin)) {
            return origin;
          }
          let domain = this.domainMatch(url);
          if (domain) return domain;
          let protocol = url.protocol;
          if (this.has(protocol)) {
            return protocol;
          }
        }
      }
      return null;
    }

    domainMatch(url) {
      let {protocol, hostname} = url;
      if (!hostname) return null;
      if (!tld.preserveFQDNs) hostname = tld.normalize(hostname);
      let secure = protocol === "https:";
      let isIPv4 = IPV4_RX.test(hostname);
      for (let domain = hostname;;) {
        if (this.has(domain)) {
          return domain;
        }
        if (secure) {
          let ssDomain = Sites.secureDomainKey(domain);
          if (this.has(ssDomain)) {
            return ssDomain;
          }
        }

        if (isIPv4) {
           // subnet shortcuts
          let dotPos = domain.lastIndexOf(".");
          if (!(dotPos > 3 || domain.indexOf(".") < dotPos)) {
            break; // we want at least the 2 most significant bytes
          }
          domain = domain.substring(0, dotPos);
        } else {
          // (sub)domain matching
          let dotPos = domain.indexOf(".");
          if (dotPos === -1) {
            break;
          }
          domain = domain.substring(dotPos + 1); // upper level
          if (!domain) {
            break;
          }
        }
      }
      return null;
    }

    dry() {
      let dry;
      if (this.size) {
        dry = Object.create(null);
        for (let [key, perms] of this) {
          dry[key] = perms.dry();
        }
      }
      return dry;
    }

    static hydrate(dry, obj = new Sites()) {
      if (dry) {
        for (let [key, dryPerms] of Object.entries(dry)) {
          obj.set(key, Permissions.hydrate(dryPerms));
        }
      }
      return obj;
    }
  }

  class Permissions {

    constructor(capabilities, temp = false, contextual = null) {
      this.capabilities = new Set(capabilities);
      this.temp = temp;
      this.contextual = contextual instanceof Sites ? contextual : new Sites(contextual);
    }

    dry() {
      return {capabilities: [...this.capabilities], contextual: this.contextual.dry(), temp: this.temp};
    }

    static hydrate(dry = {}, obj = null) {
      let capabilities = new Set(dry.capabilities);
      let contextual = Sites.hydrate(dry.contextual);
      let temp = dry.temp;
      return obj ? Object.assign(obj, {capabilities, temp, contextual, _tempTwin: undefined})
                 : new Permissions(capabilities, temp, contextual);
    }

    static typed(capability, type) {
      let [capName] = capability.split(":");
      return `${capName}:${type}`;
    }

    allowing(capability) {
      return this.capabilities.has(capability);
    }

    set(capability, enabled = true) {
      if (enabled) {
        this.capabilities.add(capability);
      } else {
        this.capabilities.delete(capability);
      }
      return enabled;
    }
    sameAs(otherPerms) {
      let otherCaps = new Set(otherPerms.capabilities);
      let theseCaps = this.capabilities;
      for (let c of theseCaps) {
        if (!otherCaps.delete(c)) return false;
      }
      for (let c of otherCaps) {
        if (!theseCaps.has(c)) return false;
      }
      return true;
    }
    clone() {
      return new Permissions(this.capabilities, this.temp, this.contextual);
    }
    get tempTwin() {
      return this._tempTwin || (this._tempTwin = new Permissions(this.capabilities, true, this.contextual));
    }

  }

  Permissions.ALL = ["script", "object", "media", "frame", "font", "webgl", "fetch", "ping", "other"];
  Permissions.IMMUTABLE = {
    UNTRUSTED: {
      "script": false,
      "object": false,
      "webgl": false,
      "fetch": false,
      "other": false,
      "ping": false,
    },
    TRUSTED: {
      "script": true,
    }
  };

  Object.freeze(Permissions.ALL);

  function defaultOptions() {
    return {
      sites:{
        trusted: `addons.mozilla.org
          afx.ms ajax.aspnetcdn.com
          ajax.googleapis.com bootstrapcdn.com
          code.jquery.com firstdata.com firstdata.lv gfx.ms
          google.com googlevideo.com gstatic.com
          hotmail.com live.com live.net
          maps.googleapis.com mozilla.net
          netflix.com nflxext.com nflximg.com nflxvideo.net
          noscript.net
          outlook.com passport.com passport.net passportimages.com
          paypal.com paypalobjects.com
          securecode.com securesuite.net sfx.ms tinymce.cachefly.net
          wlxrs.com
          yahoo.com yahooapis.com
          yimg.com youtube.com ytimg.com`.split(/\s+/).map(Sites.secureDomainKey),
        untrusted: [],
        custom: {},
      },
      DEFAULT: new Permissions(["frame", "fetch", "other"]),
      TRUSTED: new Permissions(Permissions.ALL),
      UNTRUSTED: new Permissions(),
      enforced: true,
      autoAllowTop: false,
    };
  }

  function normalizePolicyOptions(dry) {
    let options = Object.assign({}, dry);
    for (let p of ["DEFAULT", "TRUSTED", "UNTRUSTED"]) {
      options[p] = dry[p] instanceof Permissions ? dry[p] : Permissions.hydrate(dry[p]);
      options[p].temp = false; // preserve immutability of presets persistence
    }
    if (typeof dry.sites === "object" && !(dry.sites instanceof Sites)) {
      let {trusted, untrusted, temp, custom} = dry.sites;
      let sites = Sites.hydrate(custom);
      for (let key of trusted) {
        sites.set(key, options.TRUSTED);
      }
      for (let key of untrusted) {
        sites.set(Sites.toggleSecureDomainKey(key, false), options.UNTRUSTED);
      }
      if (temp) {
        let tempPreset = options.TRUSTED.tempTwin;
        for (let key of temp) sites.set(key, tempPreset);
      }
      options.sites = sites;
    }
    enforceImmutable(options);
    return options;
  }

  function enforceImmutable(policy) {
    for (let [preset, filter] of Object.entries(Permissions.IMMUTABLE)) {
      let presetCaps = policy[preset].capabilities;
      for (let [cap, value] of Object.entries(filter)) {
        if (value) presetCaps.add(cap);
        else presetCaps.delete(cap);
      }
    }
  }

  class Policy {

    constructor(options = defaultOptions()) {
      Object.assign(this, normalizePolicyOptions(options));
    }

    static hydrate(dry, policyObj) {
      return policyObj ? Object.assign(policyObj,  normalizePolicyOptions(dry))
        : new Policy(dry);
    }

    dry(includeTemp = false) {
      let trusted = [],
        temp = [],
        untrusted = [],
        custom = Object.create(null);

      const {DEFAULT, TRUSTED, UNTRUSTED} = this;
      for(let [key, perms] of this.sites) {
        if (!includeTemp && perms.temp) {
          continue;
        }
        switch(perms) {
          case TRUSTED:
            trusted.push(key);
            break;
          case TRUSTED.tempTwin:
            temp.push(key);
            break;
          case UNTRUSTED:
            untrusted.push(key);
            break;
          case DEFAULT:
            break;
          default:
            custom[key] = perms.dry();
        }
      }

      let sites = {
        trusted,
        untrusted,
        custom
      };
      if (includeTemp) {
        sites.temp = temp;
      }
      enforceImmutable(this);
      return {
        DEFAULT: DEFAULT.dry(),
        TRUSTED: TRUSTED.dry(),
        UNTRUSTED: UNTRUSTED.dry(),
        sites,
        enforced: this.enforced,
        autoAllowTop: this.autoAllowTop,
      };
    }

    static requestKey(url, type, documentUrl, includePath = false) {
      url = includePath ? Sites.parse(url).siteKey : Sites.origin(url);
      return `${type}@${url}<${Sites.origin(documentUrl)}`;
    }

    static explodeKey(requestKey) {
      let [, type, url, documentUrl] = /(\w+)@([^<]+)<(.*)/.exec(requestKey);
      return {url, type, documentUrl};
    }

    set(site, perms, cascade = false) {
      let sites = this.sites;
      let {url, siteKey} = Sites.parse(site);

      sites.delete(siteKey);
      let wideSiteKey = Sites.toggleSecureDomainKey(siteKey, false);

      if (perms === this.UNTRUSTED) {
        cascade = true;
        siteKey = wideSiteKey;
      } else {
        if (wideSiteKey !== siteKey) {
          sites.delete(wideSiteKey);
        }
      }
      if (cascade && !url) {
        for (let subMatch; (subMatch = sites.match(siteKey));) {
          sites.delete(subMatch);
        }
      }

      if (!perms || perms === this.DEFAULT) {
        perms = this.DEFAULT;
      } else {
        sites.set(siteKey, perms);
      }
      return {siteKey, perms};
    }

    get(site, ctx = null) {
      let perms, contextMatch;
      let siteMatch = !(this.onlySecure && /^\w+tp:/i.test(site)) && this.sites.match(site);
      if (siteMatch) {
        perms = this.sites.get(siteMatch);
        if (ctx) {
          contextMatch = perms.contextual.match(ctx);
          if (contextMatch) perms = perms.contextual.get(ctx);
        }
      } else {
        perms = this.DEFAULT;
      }

      return {perms, siteMatch, contextMatch};
    }

    can(url, capability = "script", ctx = null) {
      return !this.enforced ||
        this.get(url, ctx).perms.allowing(capability);
    }

    get snapshot() {
      return JSON.stringify(this.dry(true));
    }

    cascadeRestrictions(perms, topUrl) {
      let topPerms = this.get(topUrl, topUrl).perms;
      if (topPerms !== perms) {
        let topCaps = topPerms.capabilities;
        perms = new Permissions([...perms.capabilities].filter(c => topCaps.has(c)),
          perms.temp, perms.contextual);
      }
      return perms;
    }

    equals(other) {
      this.snapshot === other.snapshot;
    }
  }

  return {Permissions, Policy, Sites};
})();
