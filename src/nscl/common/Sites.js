var Sites = (() => {
  'use strict';
  const SECURE_DOMAIN_PREFIX = "§:";
  const SECURE_DOMAIN_RX = new RegExp(`^${SECURE_DOMAIN_PREFIX}`);
  const DOMAIN_RX = new RegExp(`(?:^\\w+://|${SECURE_DOMAIN_PREFIX})?([^/]*)`, "i");
  const IPV4_RX = /^(?:\d+\.){1,3}\d+/;
  const INTERNAL_SITE_RX = /^(?:(?:about|chrome|resource|(?:moz|chrome)-.*):|\[System)/;
  const VALID_SITE_RX = /^(?:(?:(?:(?:http|ftp|ws)s?|file):)(?:(?:\/\/)[\w\u0100-\uf000][\w\u0100-\uf000.-]*[\w\u0100-\uf000.](?:$|\/))?|[\w\u0100-\uf000][\w\u0100-\uf000.-]*[\w\u0100-\uf000]$)/;

  let rxQuote = s => s.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");

  /**
   * a Map whose keys are (partial) URLs, used by Policy to store per-site Permissions 
   * and providing several utility functions for URL/origin manipulation and mapping.
   */
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
          ([siteKey] = site.split(/[?#]/)); // drop any search / hash segment
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
  return Sites;
})();