'use strict';

var sitesUI;
var port;
addEventListener("unload", e => {
  if (!UI.initialized) {
    Messages.send("openStandalonePopup");
  }
});

(async () => {

  function showMessage(className, message) {
    let el = document.getElementById("message");
    el.textContent = message;
    el.className = className;
  }

  try {
    let tabId;
    let isBrowserAction = true;
    let optionsClosed = false;
    let tab = (await browser.tabs.query({
      windowId: browser.windows ?
        (await browser.windows.getLastFocused()).id
        : null,
      active: true
    }))[0];

    if (!tab || tab.id === -1) {
      log("No tab found to open the UI for");
      close();
    }
    if (tab.url === document.URL) {
      isBrowserAction = false;
      try {
        tabId = parseInt(document.URL.match(/#.*\btab(\d+)/)[1]);
      } catch (e) {
        close();
      }
      addEventListener("blur", close);
    } else {
      tabId = tab.id;
    }

    addEventListener("keydown", e => {
      if (e.code === "Enter") {
        let focused = document.activeElement;
        if (focused && focused.matches(".preset")) {
          close();
        }
      }
    })

    port = browser.runtime.connect({name: "noscript.popup"});
    await UI.init(tabId);

    function pendingReload(b) {
      try {
        port.postMessage({tabId, pendingReload: b});
      } catch (e) {
        debug(e);
      }
    }


    if (isBrowserAction) {
      browser.tabs.onActivated.addListener(e => {
        if (e.tabId !== tabId) close();
      });
    }

    await include("/ui/toolbar.js");
    {
      let handlers = {
        "options": e => {
          if (UA.mobile) { // Fenix fails on openOptionsPage
            browser.tabs.create({url: browser.extension.getURL("/ui/options.html")});
          } else {
            browser.runtime.openOptionsPage();
          }
          close();
        },
        "close": close,
        "reload": reload,
        "temp-trust-page": e => sitesUI.tempTrustAll(),
        "revoke-temp": e => {
          UI.revokeTemp();
          close();
        }
      };

      for (let b of document.querySelectorAll("#top > .icon")) {
        b.tabIndex = 0;
        if (b.id in handlers) {
          let h = handlers[b.id];
          b.onclick = h;
        }
      }

     let keyHandlers = {
        "r": "reload",
        "o": "options",
        "p": "temp-trust-page",
        "f": "revoke-temp",
        "G": "enforce",
        "T": "enforce-tab",
      };

      window.addEventListener("keydown", e => {
        let buttonId = keyHandlers[e.key];
        if (buttonId) document.getElementById(buttonId).click();
      }, true);

      let navigate = e => {
        let sel = e.code === "ArrowUp" ? ":last-child" : "";
        document.querySelector(`.sites tr.site${sel} input.preset:checked`).focus();
        e.preventDefault();
        e.stopPropagation();
      }

      document.querySelector("#top").addEventListener("keydown", e => {
        switch(e.code) {
          case "Space":
          case "Enter":
            e.target.click();
            e.preventDefault();
            break;
          case "ArrowDown":
          case "ArrowUp":
            navigate(e);
          break;
          case "ArrowLeft":
          case "ArrowRight":
          {
            let focused = document.activeElement;
            let all = [...focused.parentNode.querySelectorAll(".icon")];
            let index = all.indexOf(focused);
            if (index === -1) return;
            index += e.code === "ArrowRight" ? 1 : -1;
            if (index >= all.length) index = 0;
            else if (index < 0) index = all.length -1;
            all[index].focus();
            break;
          }
        }
      }, true);
    }
    {
      let policy = UI.policy;
      let pressed = policy.enforced;
      let button = document.getElementById("enforce");
      button.setAttribute("aria-pressed", pressed);
      button.textContent = button.title = _(pressed ? "NoEnforcement" :  "Enforce");
      button.onclick = async () => {
        this.disabled = true;
        policy.enforced = !pressed;
        await UI.updateSettings({policy, reloadAffected: true});
        close();
      }
    }
    {
      let pressed = !UI.unrestrictedTab;
      let button = document.getElementById("enforce-tab");
      button.setAttribute("aria-pressed", pressed);
      button.textContent = button.title = _(pressed ? "NoEnforcementForTab" :  "EnforceForTab");
      if (UI.policy.enforced) {
        button.onclick = async () => {
          this.disabled = true;
          await UI.updateSettings({
            unrestrictedTab: pressed,
            reloadAffected: true,
          });
          close();
        }
      } else {
        button.disabled = true;
      }
    }


    let mainFrame = UI.seen && UI.seen.find(thing => thing.request.type === "main_frame");
    debug("Seen: %o", UI.seen);
    if (!mainFrame) {
      let isHttp = /^https?:/.test(tab.url);
      try {
        await browser.tabs.executeScript(tabId, { code: "" });
        if (isHttp) {
          document.body.classList.add("disabled");
          showMessage("warning", _("freshInstallReload"));
          let buttons = document.querySelector("#buttons");
          let b = document.createElement("button");
          b.textContent = _("OK");
          b.onclick = document.getElementById("reload").onclick = () => {
            reload();
            close();
          }
          buttons.appendChild(b);
          b = document.createElement("button");
          b.textContent = _("Cancel");
          b.onclick = () => close();
          buttons.appendChild(b);
          return;
        }
      } catch (e) {
        error(e, "Could not run scripts on %s: privileged page?", tab.url);
      }

      await include("/lib/restricted.js");
      let isRestricted = isRestrictedURL(tab.url);
      if (!isHttp || isRestricted) {
        showMessage("warning", _("privilegedPage"));
        let tempTrust = document.getElementById("temp-trust-page");
        tempTrust.disabled = true;
        return;
      }
      if (!UI.seen) {
        if (!isHttp) return;
        UI.seen = [
          mainFrame = {
            request: { url: tab.url, documentUrl: tab.url, type: "main_frame" }
          }
        ];
      }
    }

    let justDomains = !UI.local.showFullAddresses;

    sitesUI = new UI.Sites(document.getElementById("sites"));

    sitesUI.onChange = (row) => {
      pendingReload(sitesUI.anyPermissionsChanged());
      if (optionsClosed) return;
      browser.tabs.query({
        url: browser.extension.getURL(
            browser.runtime.getManifest().options_ui.page)
        }).then(tabs => {
          browser.tabs.remove(tabs.map(t => t.id));
      });
      optionsClosed = true;
    };
    initSitesUI();
    UI.onSettings = initSitesUI;



    function initSitesUI() {
      pendingReload(false);
      let {
        typesMap
      } = sitesUI;
      typesMap.clear();
      let policySites = UI.policy.sites;
      let domains = new Map();
      let protocols = new Set();
      function urlToLabel(url) {
        let origin = Sites.origin(url);
        let match = policySites.match(url);
        if (match) {
          if (match === url.protocol) {
            protocols.add(match);
          } else {
            return match;
          }
        }
        if (domains.has(origin)) {
          if (justDomains) return domains.get(origin);
        } else {
          let domain = tld.getDomain(url.hostname);
          if (domain) {
            domain = url.protocol === "https:" ? Sites.secureDomainKey(domain) : domain;
          } else {
            domain = url.protocol;
          }
          domains.set(origin, domain);
          if (justDomains) return domain;
        }
        return origin;
      }
      let seen = UI.seen;
      let parsedSeen = seen.map(thing => Object.assign({
          type: thing.policyType
        }, Sites.parse(thing.request.url)))
        .filter(parsed => parsed.url && (
            parsed.url.origin !== "null" || parsed.url.protocol === "file:"));

      let sitesSet = new Set(
        parsedSeen.map(parsed => parsed.label = urlToLabel(parsed.url))
      );
      if (!justDomains) {
        for (let domain of domains.values()) sitesSet.add(domain);
      }
      for (let protocol of protocols) sitesSet.add(protocol);
      let sites = [...sitesSet];
      for (let parsed of parsedSeen) {
        sites.filter(s => parsed.label === s || domains.get(Sites.origin(parsed.url)) === s).forEach(m => {
          let siteTypes = typesMap.get(m);
          if (!siteTypes) typesMap.set(m, siteTypes = new Set());
          siteTypes.add(parsed.type);
        });
      }

      sitesUI.mainUrl = new URL(mainFrame.request.url)
      sitesUI.mainSite = urlToLabel(sitesUI.mainUrl);
      sitesUI.mainDomain = tld.getDomain(sitesUI.mainUrl.hostname);

      sitesUI.render(sites);
    }

    function reload() {
      if (sitesUI) sitesUI.clear();
      browser.tabs.reload(tabId);
      pendingReload(false);
    }

    function close() {
      if (isBrowserAction) {
        window.close();
      } else {
        browser.tabs.remove(tab.id);
      }
    }

    let {
      onCompleted
    } = browser.webNavigation;

    let loadSnapshot = sitesUI.snapshot;
    let onCompletedListener = navigated => {
      if (navigated.tabId === tabId) {
        setTimeout(() => UI.pullSettings(), 500);
      }
    };
    onCompleted.addListener(onCompletedListener, {
      url: [{
        hostContains: sitesUI.mainDomain
      }]
    });
    addEventListener("blur", e => {
      onCompleted.removeListener(onCompletedListener);
      port.disconnect(); // otherwise Vivaldi keeps it after closing
    });
  } catch (e) {
    error(e, "Can't open popup");
    close();
  }

})();
