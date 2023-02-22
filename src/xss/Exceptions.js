/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

XSS.Exceptions = (() => {

  var Exceptions = {
    get legacyExceptions() {
      delete this.legacyExceptions;
      this.legacyExceptions =
        Legacy.getRxPref("filterXExceptions",
          Legacy.RX.multi, "g", /^https?:[a-z:/@.?-]*$/i);
      return this.legacyExceptions;
    },

    async getWhitelist() {
      return (await Storage.get("sync", "xssWhitelist")).xssWhitelist;
    },
    async setWhitelist(xssWhitelist) {
      await Storage.set("sync", {xssWhitelist});
    },

    async shouldIgnore(xssReq) {
      function logEx(...args) {
        debug("[XSS preprocessing] Ignoring %o", xssReq, ...args);
      }

      let {
        srcObj,
        destObj,
        srcUrl,
        destUrl,
        srcOrigin,
        destOrigin,
        unescapedDest,
        isGet,
        isPost
      } = xssReq;

      // same srcUrl
      if (srcOrigin === destOrigin) {
        return true;
      }

      // same domain + https: source
      if (/^https:/.test(srcOrigin) && xssReq.srcDomain === xssReq.destDomain) {
        return true;
      }

      if (/^(?:chrome|resource|moz-extension|about):/.test(srcOrigin)) {
        debug("Privileged origin", srcOrigin);
      }

      // destination or @source matching legacy regexp
      if (this.legacyExceptions &&
          (this.legacyExceptions.test(unescapedDest) &&
          !this.isBadException(xssReq.destDomain) ||
          this.legacyExceptions.test("@" + unescape(srcUrl))
        )) {
        logEx("Legacy exception", this.legacyExceptions);
        return true;
      }

      if (!srcOrigin && isGet) {
        if (/^https?:\/\/msdn\.microsoft\.com\/query\/[^<]+$/.test(unescapedDest)) {
          return true; // MSDN from Microsoft VS
        }
      }

      if (srcOrigin) { // srcUrl-specific exceptions

        if (/^about:(?!blank)/.test(srcOrigin))
          return true; // any about: URL except about:blank

        if (srcOrigin === "https://www.youtube.com" &&
          /^https:\/\/(?:plus\.googleapis|apis\.google)\.com\/[\w/]+\/widget\/render\/comments\?/.test(destUrl) &&
          Legacy.getPref("filterXExceptions.yt_comments")
        ) {
          logEx("YouTube comments exception");
          return true;
        }

        if (isPost) {

          if (srcOrigin === "https://sso.post.ch" && destOrigin === "https://app.swisspost.ch") {
            return true;
          }

          if (srcOrigin === "https://twitter.com" && /^https:\/\/.*\.twitter\.com$/.test(destOrigin)) {
            return true;
          }

          {
            let rx = /^https:\/\/(?:[a-z]+\.)?unionbank\.com$/;
            if (rx.test(srcOrigin) && rx.test(destOrigin)) {
              return true;
            }
          }

          if (/^https?:\/\/csr\.ebay\.(?:\w{2,3}|co\.uk)\/cse\/start\.jsf$/.test(srcUrl) &&
            /^https?:\/\/msa-lfn\.ebay\.(?:\w{2,3}|co\.uk)\/ws\/eBayISAPI\.dll\?[^<'"%]*$/.test(unescapedDest) &&
            destObj.protocol === srcObj.protocol &&
            Legacy.getPref("filterXException.ebay")) {
            logEx("Ebay exception");
            return true;
          }

          if (/^https:\/\/(?:cap\.securecode\.com|www\.securesuite\.net|(?:.*?\.)?firstdata\.(?:l[tv]|com))$/.test(srcUrl) &&
            Legacy.getPref("filterXException.visa")) {
            logEx("Verified by Visa exception");
            return true;
          }

          if (/\.verizon\.com$/.test(srcOrigin) &&
            /^https:\/\/signin\.verizon\.com\/sso\/authsso\/forumLogin\.jsp$/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.verizon")) {
            logEx("Verizon login exception");
            return true;
          }

          if (/^https?:\/\/mail\.lycos\.com\/lycos\/mail\/MailCompose\.lycos$/.test(srcUrl) &&
            /\.lycosmail\.lycos\.com$/.test(destOrigin) &&
            Legacy.getPref("filterXExceptions.lycosmail")) {
            logEx("Lycos Mail exception");
            return true;
          }

          if (/\.livejournal\.com$/.test(srcOrigin) &&
            /^https?:\/\/www\.livejournal\.com\/talkpost_do\.bml$/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.livejournal")) {
            logEx("Livejournal comments exception");
            return true;
          }

          if (srcOrigin == "https://ssl.rapidshare.com" &&
            xssReq.srcDomain == "rapidshare.com") {
            logEx("Rapidshare upload exception");
            return true;
          }

          if (srcOrigin == "http://wm.letitbit.net" &&
            /^http:\/\/http\.letitbit\.net:81\/cgi-bin\/multi\/upload\.cgi\?/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.letitibit")
          ) {
            logEx("letitbit.net upload exception");
            return true;
          }

          if (/\.deviantart\.com$/.test(srcOrigin) &&
            /^http:\/\/my\.deviantart\.com\/journal\/update\b/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.deviantart")
          ) {
            logEx("deviantart.com journal post exception");
            return true;
          }

          if (srcOrigin == "https://www.mymedicare.gov" &&
            destOrigin == "https://myporal.medicare.gov" &&
            Legacy.getPref("filterXExceptions.medicare")
          ) {
            logEx("mymedicare.gov exception");
            return true;
          }

          if (/^https?:\/\/(?:draft|www)\.blogger\.com\/template-editor\.g\?/.test(srcUrl) &&
            /^https?:\/\/[\w\-]+\.blogspot\.com\/b\/preview\?/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.blogspot")
          ) {
            logEx("blogspot.com template preview exception");
            return true;
          }

          if (/^https?:\/\/www\.readability\.com\/articles\/queue$/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.readability")) {
            logEx("Readability exception");
            return true;
          }

          if (/^https?:\/\/pdf\.printfriendly\.com\/pdfs\/make$/.test(destUrl) &&
            Legacy.getPref("filterXExceptions.printfriendly")) {
            logEx("Printfriendly exception");
            return true;
          }
        }
      }
    },

    isBadException(host) {
      // TLD check for Google search
      let m = host.match(/\bgoogle\.((?:[a-z]{1,3}\.)?[a-z]+)$/i);
      return m && tld.getPublicSuffix(host) != m[1];
    },

    partial(xssReq) {
      let {
        srcObj,
        destObj,
        srcUrl,
        destUrl,
        srcOrigin,
        destOrigin,
      } = xssReq;

      let skipParams, skipRx;
      if (/^https:\/\/www\.paypal\.com\/(?:[\w\-]+\/)?cgi-bin\/webscr\b/.test(destUrl)) {
        // Paypal buttons encrypted parameter causes a DOS, strip it out
        skipParams = ['encrypted'];
      } else if (/\.adnxs\.com$/.test(srcOrigin) && /\.adnxs\.com$/.test(destOrigin)) {
        skipParams = ['udj'];
      } else if (/^https?:\/\/www\.mendeley\.com\/import\/bookmarklet\/$/.test(destUrl)) {
        skipParams = ['html'];
      } else if (destObj.hash && /^https:/.test(srcOrigin) &&
        (/^https?:\/\/api\.facebook\.com\//.test(srcUrl) ||
          /^https:\/\/tbpl\.mozilla\.org\//.test(srcUrl) || // work-around for hg reftest DOS
          /^https:\/\/[^\/]+\.googleusercontent\.com\/gadgets\/ifr\?/.test(destUrl) // Google gadgets
        )) {
        skipRx = /#[^#]+$/; // remove receiver's hash
      } else if (/^https?:\/\/apps\.facebook\.com\//.test(srcUrl) && Legacy.getPref("filterXExceptions.fbconnect")) {
        skipRx = /&invite_url=javascript[^&]+/; // Zynga stuff
      } else if (/^https?:\/\/l\.yimg\.com\/j\/static\/frame\?e=/.test(destUrl) &&
        /\.yahoo\.com$/.test(srcOrigin) &&
        Legacy.getPref("filterXExceptions.yahoo")) {
        skipParams = ['e'];
      } else if (/^https?:\/\/wpcomwidgets\.com\/\?/.test(destUrl)) {
        skipParams = ["_data"];
      } else if (/^https:\/\/docs\.google\.com\/picker\?/.test(destUrl)) {
        skipParams = ["nav", "pp"];
      } else if (/^https:\/\/.*[\?&]scope=/.test(destUrl)) {
        skipRx = /[\?&]scope=[+\w]+(?=&|$)/;
      }
      if (skipParams) {
        skipRx = new RegExp("(?:^|[&?])(?:" + skipParams.join('|') + ")=[^&]+", "g");
      }
      return {
        skipParams,
        skipRx
      };
    }

  };
  return Exceptions;
})();
