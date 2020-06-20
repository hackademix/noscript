'use strict';
var UI = (() => {

  var UI = {
    initialized: false,

    presets: {
      "DEFAULT": "Default",
      "T_TRUSTED": "Trusted_temporary",
      "TRUSTED": "Trusted_permanent",
      "UNTRUSTED": "Untrusted",
      "CUSTOM": "Custom",
    },

    async init(tab) {
      UI.tabId = tab ? tab.id : -1;
      document.documentElement.classList.toggle("incognito",
        UI.incognito = tab && tab.incognito
      );
      let scripts = [
        "/ui/ui.css",
        "/lib/Messages.js",
        "/lib/punycode.js",
        "/lib/tld.js",
        "/common/Policy.js",
      ];
      this.mobile = UA.mobile;
      if (this.mobile) {
        document.documentElement.classList.toggle("mobile", true);
        scripts.push("/lib/fastclick.js");
      }
      await include(scripts);

      let inited = new Promise(resolve => {
        Messages.addHandler({
          async settings(m) {
            if (!UI.tabId === m.tabId) return;
            UI.policy = new Policy(m.policy);
            UI.snapshot = UI.policy.snapshot;
            UI.seen = m.seen;
            UI.unrestrictedTab = m.unrestrictedTab;
            UI.xssUserChoices = m.xssUserChoices;
            UI.local = m.local;
            UI.sync = m.sync;
            UI.forceIncognito = UI.incognito && !UI.sync.overrideTorBrowserPolicy;
            if (UI.local) {
              if (!UI.local.debug) {
                debug = () => {}; // be quiet!
              }
              document.documentElement.classList.toggle("tor", !!UI.local.isTorBrowser);
              if (UI.local.isTorBrowser) {
                Sites.onionSecure = true;
              }
            }
            resolve();
            if (UI.onSettings) UI.onSettings();
            await HighContrast.init();
          }
        });

        if (this.mobile) FastClick.attach(document.body);
        UI.pullSettings();
      });

      await inited;

      this.initialized = true;
      debug("Imported", Policy);
    },
    async pullSettings() {
      Messages.send("broadcastSettings", {tabId: UI.tabId});
    },
    async updateSettings({policy, xssUserChoices, unrestrictedTab, local, sync, reloadAffected}) {
      if (policy) policy = policy.dry(true);
      return await Messages.send("updateSettings", {
        policy,
        xssUserChoices,
        unrestrictedTab,
        local,
        sync,
        reloadAffected,
        tabId: UI.tabId,
      });
    },

    async exportSettings() {
      return await Messages.send("exportSettings");
    },
    async importSettings(data) {
      return await Messages.send("importSettings", {data});
    },

    async revokeTemp() {
      let policy = this.policy;
      Policy.hydrate(policy.dry(), policy);
      if (this.isDirty(true)) {
        await this.updateSettings({policy, reloadAffected: true});
      }
    },

    isDirty(reset = false) {
      let currentSnapshot = this.policy.snapshot;
      let dirty = currentSnapshot != this.snapshot;
      if (reset) this.snapshot = currentSnapshot;
      return dirty;
    },

    async openSiteInfo(domain) {
      let url = `/ui/siteInfo.html#${encodeURIComponent(domain)};${UI.tabId}`;
      browser.tabs.create({url});
    },

    wireOption(name, storage = "sync", onchange) {
      let input = document.querySelector(`#opt-${name}`);
      if (!input) {
        debug("Checkbox not found %s", name);
        return;
      }
      if (typeof storage === "function") {
        input.onchange = e => storage(input);
        input.checked = storage(null);
      } else {
        let obj = UI[storage];
        if (!obj) log(storage);
        input.checked = obj[name];
        if (onchange) onchange(input.checked);
        input.onchange = async () => {
          obj[name] = input.checked;
          await UI.updateSettings({[storage]: obj});
          if (onchange) onchange(obj[name]);
        }
      }
      return input;
    }
  };

  var HighContrast = {
    css: null,
    async init() {
      this.widget = UI.wireOption("highContrast", "local", value => {
        UI.highContrast = value;
        this.toggle();
      });
      await this.toggle();
    },
    async toggle() {
      let hc = "highContrast" in UI ? UI.highContrast : await this.detect();
      if (hc) {
        if (this.css) {
          document.documentElement.appendChild(this.css);
        } else {
          this.css = await include("/ui/ui-hc.css")
        }
      } else if (this.css) {
        this.css.remove();
      }
      document.documentElement.classList.toggle("hc", hc);
      if (this.widget) {
        this.widget.checked = hc;
      }
    },

    detect() {
      if ("highContrast" in UI.local) {
        UI.highContrast = UI.local.highContrast;
      } else {
        // auto-detect
        let canary = document.createElement("input");
        canary.className="https-only";
        canary.style.display = "none";
        document.body.appendChild(canary);
        UI.highContrast = window.getComputedStyle(canary).backgroundImage === "none";
        canary.remove();
      }
      return UI.highContrast;
    }
  };

  function fireOnChange(sitesUI, data) {
    if (UI.isDirty(true)) {
      UI.updateSettings({policy: UI.policy});
      if (sitesUI.onChange) sitesUI.onChange(data, this);
    }
  }

  function compareBy(prop, a, b) {
    let x = a[prop], y = b[prop];
    if (x.endsWith(":")) {
      if (!y.endsWith(":")) {
        return this.mainDomain ? 1 : -1;
      }
    } else if (y.endsWith(":")) {
      return this.mainDomain ? -1 : 1;
    }
    return x > y ? 1 : x < y ? -1 : 0;
  }

  const TEMPLATE = `
    <table class="sites">
    <tr class="site">

    <td class="presets">
    <span class="preset">
      <input id="preset" class="preset" type="radio" name="preset"><label for="preset" class="preset">PRESET</label>
      <input tabindex="-1" id="temp" class="temp" type="checkbox"><label for="temp">Temporary</label></input>
    </span>
    </td>

    <td class="url" data-key="secure">
    <input tabindex="0" class="https-only" id="https-only" type="checkbox"><label for="https-only" class="https-only"></label>
    <span tabindex="0" class="full-address" aria-role="button">
    <span class="protocol">https://</span><span class="sub">www.</span><span class="domain">noscript.net</span><span class="path"></span>
    </span>
    </td>



    </tr>
    <tr tabindex="-1" class="customizer">
    <td colspan="2">
    <div class="customizer-controls">
    <fieldset><legend></legend>
    <span class="cap">
      <input class="cap" type="checkbox" value="script" />
      <label class="cap">script</label>
    </span>
    </fieldset>
    </div>
    </td>
    </tr>
    </table>
  `;

  const TEMP_PRESETS = ["CUSTOM"];
  const DEF_PRESETS =  {
    // name: customizable,
    "DEFAULT": false,
    "T_TRUSTED": false,
    "TRUSTED": false,
    "UNTRUSTED": false,
    "CUSTOM": true,
  };
  const INCOGNITO_PRESETS = ["DEFAULT", "T_TRUSTED", "CUSTOM"];

  UI.Sites = class {
    constructor(parentNode, presets = DEF_PRESETS) {
      this.parentNode = parentNode;
      let policy = UI.policy;
      this.uiCount =  UI.Sites.count = (UI.Sites.count || 0) + 1;
      this.sites = policy.sites;
      this.presets = presets;
      this.customizing = null;
      this.typesMap = new Map();
      this.clear();
    }

    initRow(table = this.table) {
      let row = table.querySelector("tr.site");
      // PRESETS
      {
        let presets = row.querySelector(".presets");
        let [span, input, label] = presets.querySelectorAll("span.preset, input.preset, label.preset");
        span.remove();
        for (let [preset, customizable] of Object.entries(this.presets)) {
          let messageKey = UI.presets[preset];
          input.value = preset;
          label.textContent = label.title = input.title = _(messageKey);
          input.disabled = UI.forceIncognito && !INCOGNITO_PRESETS.includes(preset);
          let clone = span.cloneNode(true);
          clone.classList.add(preset);
          let temp = clone.querySelector(".temp");
          if (TEMP_PRESETS.includes(preset)) {
            temp.title = _("allowTemp", `(${label.title.toUpperCase()})`);
            temp.nextElementSibling.textContent = _("allowTemp", ""); // label;
            temp.disabled = UI.forceIncognito;
          } else {
            temp.nextElementSibling.remove();
            temp.remove();
          }

          presets.appendChild(clone);
        }

        if (!UI.mobile) {
          UI.Sites.correctSize(presets);
        }

      }

      // URL
      {
        let [input, label] = row.querySelectorAll("input.https-only, label.https-only");
        input.title = label.title = label.textContent = _("httpsOnly");
      }

      // CUSTOMIZER ROW
      {
        let [customizer, legend, cap, capInput, capLabel] = table.querySelectorAll(".customizer, legend, span.cap, input.cap, label.cap");
        row._customizer = customizer;
        customizer.remove();
        let capParent = cap.parentNode;
        capParent.removeChild(cap);
        legend.textContent = _("allow");
        let idSuffix = UI.Sites.count;
        for (let capability of Permissions.ALL) {
          capInput.id = `capability-${capability}-${idSuffix}`
          capLabel.setAttribute("for", capInput.id);
          capInput.value = capability;
          capInput.title = capLabel.textContent = _(`cap_${capability}`) || capability;
          let clone = capParent.appendChild(cap.cloneNode(true));
          clone.classList.add(capability);
        }
      }

      // debug(table.outerHTML);
      return row;
    }

    static correctSize(presets) {
      // adapt button to label if needed
      let sizer = document.createElement("div");
      sizer.id = "presets-sizer";
      sizer.appendChild(presets.cloneNode(true));
      document.body.appendChild(sizer);
      let presetWidth = sizer.querySelector("input.preset").offsetWidth;
      let labelWidth = 0;
      for (let l of sizer.querySelectorAll("label.preset")) {
        let lw = l.offsetWidth;
        debug("lw", l.textContent, lw);
        if (lw > labelWidth) labelWidth = lw;
      }

      debug(`Preset: %s Label: %s`, presetWidth, labelWidth);
      labelWidth += 16;
      if (presetWidth < labelWidth) {
        for (let ss of document.styleSheets) {
          if (ss.href.endsWith("/ui.css")) {
            for (let r of ss.cssRules) {
              if (/input\.preset:checked.*min-width:/.test(r.cssText)) {
                r.style.minWidth = (labelWidth) + "px";
                break;
              }
            }
          }
        }
      }

      sizer.remove();
      UI.Sites.correctSize = () => {}; // just once, please!
    }

    allSiteRows() {
      return this.table.querySelectorAll("tr.site");
    }

    anyPermissionsChanged() {
      return Array.from(this.allSiteRows()).some(row => row.permissionsChanged);
    }

    clear() {
      debug("Clearing list", this.table);
      this.template = document.createElement("template");
      this.template.innerHTML = TEMPLATE;
      this.fragment = this.template.content;
      this.table = this.fragment.querySelector("table.sites");
      this.rowTemplate = this.initRow();
      for (let r of this.allSiteRows()) {
        r.remove();
      }

      this.customize(null);
      this.sitesCount = 0;
    }

    siteNeeds(site, type) {
      let siteTypes = this.typesMap && this.typesMap.get(site);
      return !!siteTypes && siteTypes.has(type);
    }

    handleEvent(ev) {
      let target = ev.target;
      let customizer = target.closest(".customizer");
      let row = customizer ? customizer.parentNode.querySelector("tr.customizing") : target.closest("tr.site");
      if (!row) return;

      let isTemp = target.matches("input.temp");
      let preset = target.matches("input.preset") ? target
        : customizer || isTemp ? row.querySelector("input.preset:checked")
          : target.closest("input.preset");
      debug("%s target %o\n\trow %s, perms %o\npreset %s %s",
              ev.type,
              target, row && row.siteMatch, row && row.perms,
              preset && preset.value, preset && preset.checked);

      if (!preset) {
        if (target.matches("input.https-only") && ev.type === "change") {
          this.toggleSecure(row, target.checked);
          fireOnChange(this, row);
        } else if (target.matches(".domain")) {
          UI.openSiteInfo(row.domain);
        }
        return;
      }


      let {siteMatch, contextMatch, perms} = row;

      let isCap = customizer && target.matches(".cap");
      let tempToggle = preset.parentNode.querySelector("input.temp");

      if (ev.type === "change") {
        row.permissionsChanged = false;
        if (!row._originalPerms) {
          row._originalPerms = row.perms.clone();
        }
        let policy = UI.policy;
        let presetValue = preset.value;
        let policyPreset = presetValue.startsWith("T_") ? policy[presetValue.substring(2)].tempTwin : policy[presetValue];

        if (policyPreset && row.perms !== policyPreset) {
          row.perms = policyPreset;
        }
        if (preset.checked) {
          row.dataset.preset = preset.value;
        }
        if (isCap) {
          perms.set(target.value, target.checked);
        } else if (policyPreset) {
          if (tempToggle && tempToggle.checked) {
            policyPreset = policyPreset.tempTwin;
          }
          row.contextMatch = null;
          row.perms = policyPreset;
          delete row._customPerms;
          debug("Site match", siteMatch);
          if (siteMatch) {
            policy.set(siteMatch, policyPreset);
          } else {
            this.customize(policyPreset, preset, row);
          }

        } else if (preset.value === "CUSTOM") {
          if (isTemp) {
            row.perms.temp = target.checked || UI.forceIncognito;
          } else {
            let temp = row.perms.temp || UI.forceIncognito;
            tempToggle.checked = temp;
            let perms = row._customPerms ||
              (row._customPerms = new Permissions(new Set(row.perms.capabilities), temp));
            row.perms = perms;
            policy.set(siteMatch, perms);
            this.customize(perms, preset, row);
          }
        }
        row.permissionsChanged = !row.perms.sameAs(row._originalPerms);
        fireOnChange(this, row);
      } else if (!(isCap || isTemp) && ev.type === "click") {
          this.customize(row.perms, preset, row);
      }
    }

    customize(perms, preset, row) {
      debug("Customize preset %s (%o) - Dirty: %s", preset && preset.value, perms, this.dirty);
      for(let r of this.table.querySelectorAll("tr.customizing")) {
        r.classList.toggle("customizing", false);
      }
      let customizer = this.rowTemplate._customizer;
      customizer.classList.toggle("closed", true);

      if (!(perms && row && preset &&
        row.dataset.preset === preset.value &&
        this.presets[preset.value] &&
        preset !== customizer._preset)) {
           delete customizer._preset;
           customizer.onkeydown = null;
           customizer.remove();
           return;
      }

      customizer._preset = preset;
      row.classList.toggle("customizing", true);
      let immutable = Permissions.IMMUTABLE[preset.value] || {};
      let lastInput = null;
      for (let input of customizer.querySelectorAll("input")) {
        let type = input.value;
        if (type in immutable) {
          input.disabled = true;
          input.checked = immutable[type];
        } else {
          input.checked = perms.allowing(type);
          input.disabled = false;
          lastInput = input;
        }
        input.parentNode.classList.toggle("needed", this.siteNeeds(row._site, type));
      }

      row.parentNode.insertBefore(customizer, row.nextElementSibling);
      customizer.classList.toggle("closed", false);
      let temp = preset.parentNode.querySelector("input.temp");
      customizer.onkeydown = e => {
        if (e.shiftKey) return true;
        switch(e.code) {
          case "Tab":
            if (document.activeElement === lastInput) {
              if (temp) {
                temp.tabIndex = "0";
                temp.onblur = () => this.customize(null);
                setTimeout(() => temp.tabIndex = "-1", 50);
                preset.focus();
              }

            }
            return true;
          case "ArrowLeft":
          case "ArrowRight":
          case "ArrowUp":
            this.onkeydown = null;
            this.customize(null);
            preset.focus();
            if (!temp) return true;
            switch(e.code.substring(5)) {
              case "Left":
                return false;
              case "Right":
                temp.focus();
            }
            e.preventDefault();
            e.stopPropagation();
            return false;
          case "KeyT":
          {
            let temp = preset.parentNode.querySelector("input.temp");
            if (temp) temp.checked = !temp.checked || UI.forceIncognito;
          }
        }
      }
      window.setTimeout(() => customizer.querySelector("input:not(:disabled)").focus(), 50);
    }

    render(sites = this.sites, sorter = this.sorter) {
      let parentNode = this.parentNode;
      debug("Rendering %o inside %o", sites, parentNode);
      if (sites) this._populate(sites, sorter);
      parentNode.innerHTML = "";
      parentNode.appendChild(this.fragment);
      let root = parentNode.querySelector("table.sites");
      debug("Wiring", root);
      if (!root.wiredBy) {
        root.addEventListener("keydown", e => this._keyNavHandler(e), true);
        root.addEventListener("keyup", e => {
          // we use a keyup listener to open the customizer from other presets
          // because space repetion may lead to unintendedly "click" on the
          // first cap checkbox once focused from keydown
          switch(e.code) {
            case "Space": {
              let focused = document.activeElement;
              if (focused.matches("tr .preset")) {
                focused.closest("tr").querySelector(".preset[value='CUSTOM']").click();
                e.preventDefault();
              }
            }
          }
        }, true);
        root.addEventListener("click", this, true);
        root.addEventListener("change", this, true);
        root.wiredBy = this;
      }
      return root;
    }

    _keyNavHandler(e) {
      let focused = document.activeElement;
      if (!focused) return;
      let row = focused.closest("tr");
      if (!row || row.matches(".customizer")) return;
      let dir = "next";
      let newRow;
      let mappedPreset = ({
        "+": "TRUSTED",
        "-": "UNTRUSTED",
        "0": "DEFAULT",
        "t": "T_TRUSTED",
        "c": "CUSTOM"
      })[e.key];

      if (mappedPreset) {
        let p = row.querySelector(`.preset[value='${mappedPreset}']`);
        if (p) {
          p.focus();
          p.click();
          e.preventDefault();
        }
        return;
      }

      switch(e.code) {
        case "Delete":
        case "Backspace":
          row.querySelector(".preset[value='DEFAULT']").click();
          e.preventDefault();
          break;
        case "Enter":
        case "Space":
          if (focused.matches(".full-address")) {
            UI.openSiteInfo(row.domain);
          }
          break;
        case "Home":
          newRow = row;
        case "ArrowUp":
          dir = "previous";
        case "ArrowDown":
          if (!newRow) {
            this.customize(null);
            let prop = `${dir}ElementSibling`;
            newRow =  row[prop];
            if (!(newRow && newRow.matches("tr"))) newRow = row;
          }

          if (newRow === row) {
            let topButton = document.querySelector("#top > .icon");
            if (topButton) topButton.focus();
          } else {
            newRow.querySelector("input.preset:checked").focus();
          }
          e.preventDefault();
          e.stopPropagation();
          break;
        case "KeyS":
          row.querySelector(".https-only").click();
          break;
        case "KeyI":
          UI.openSiteInfo(row.domain);
          break;
      }
    }

    _populate(sites, sorter) {
      this.clear();
      if (sites instanceof Sites) {
        for (let [site, perms] of sites) {
          this.append(site, site, perms);
        }
      } else {
        for (let site of sites) {
          let context = null;
          if (site.site) {
            site = site.site;
            context = site.context;
          }
          let {siteMatch, perms, contextMatch} = UI.policy.get(site, context);
          this.append(site, siteMatch, perms, contextMatch);
        }
        this.sites = sites;
      }
      this.sort(sorter);
    }

    focus() {
      let firstPreset = this.table.querySelector("input.preset:checked");
      if (firstPreset) firstPreset.focus();
    }

    sort(sorter = this.sorter) {
      if (this.mainDomain) {
        let md = this.mainDomain;
        let wrappedCompare = sorter;
        sorter = (a, b) => {
          let x = a.domain, y = b.domain;
          if (x === md) {
            if (y !== md) {
              return -1;
            }
          } else if (y === md) {
            return 1;
          }
          return wrappedCompare.call(this, a, b);
        }
      }
      let rows = [...this.allSiteRows()].sort(sorter.bind(this));
      if (this.mainSite) {
        let mainLabel = "." + this.mainDomain;
        let topIdx = rows.findIndex(r => r._label === mainLabel);
        if (topIdx === -1) rows.findIndex(r => r._site === this.mainSite);
        if (topIdx !== -1) {
          // move the row to the top
          let topRow = rows.splice(topIdx, 1)[0];
          rows.unshift(topRow);
          topRow.classList.toggle("main", true);
        }
      }
      this.clear();
      for (let row of rows) this.table.appendChild(row);
    }

    sorter(a, b) {
      let cb = compareBy.bind(this);
      return cb("domain", a, b) || cb("_label", a, b);
    }

    async tempTrustAll() {
      let {policy} = UI;
      let changed = 0;
      for (let row of this.allSiteRows()) {
        if (row._preset === "DEFAULT") {
          policy.set(row._site, policy.TRUSTED.tempTwin);
          changed++;
        }
      }
      if (changed && UI.isDirty(true)) {
        await UI.updateSettings({policy, reloadAffected: true});
      }
      return changed;
    }

    createSiteRow(site, siteMatch, perms, contextMatch = null, sitesCount = this.sitesCount++) {
      debug("Creating row for site: %s, matching %s / %s, %o", site, siteMatch, contextMatch, perms);
      let policy = UI.policy;
      let row = this.rowTemplate.cloneNode(true);
      row.sitesCount = sitesCount;
      let url;
      try {
        url = new URL(site);
        if (siteMatch !== site && siteMatch === url.protocol) {
          perms = policy.DEFAULT;
        }
      } catch (e) {
        if (/^(\w+:)\/*$/.test(site)) {
          let hostname = "";
          url = {protocol: RegExp.$1, hostname, origin: site, pathname:""};
          debug("Lonely %o", url);
        } else {
          debug("Domain %s (%s)", site, siteMatch);
          let protocol = Sites.isSecureDomainKey(site) ? "https:" : "http:";
          let hostname = Sites.toggleSecureDomainKey(site, false);
          url = {protocol, hostname, origin: `${protocol}//${site}`, pathname: "/"};
        }
      }

      let hostname = Sites.toExternal(url.hostname);
      let overrideDefault = site && url.protocol && site !== url.protocol ?
        policy.get(url.protocol, contextMatch) : null;
      if (overrideDefault && !overrideDefault.siteMatch) overrideDefault = null;

      let domain = tld.getDomain(hostname);
      let disableDefault = false;
      if (!siteMatch || siteMatch === url.protocol && site !== siteMatch) {
        siteMatch = site;
      }
      let secure = Sites.isSecureDomainKey(siteMatch);
      let isOnion = UI.local.isTorBrowser && hostname && hostname.endsWith(".onion");
      let keyStyle = secure ? "secure"
        : !domain || /^\w+:/.test(siteMatch) ?
            (url.protocol === "https:" || isOnion ? "full" : "unsafe")
          : isOnion ? "secure" : domain === hostname ? "domain" : "host";

      let urlContainer = row.querySelector(".url");
      urlContainer.dataset.key = keyStyle;
      row._site = site;

      row.siteMatch = siteMatch;
      row.contextMatch = contextMatch;
      row.perms = perms;
      row.domain = domain || siteMatch;
      if (domain) { // "normal" URL
        let justDomain = hostname === domain;
        let domainEntry = secure || domain === site;
        row._label =  domainEntry ? "." + domain : site;
        row.querySelector(".protocol").textContent = `${url.protocol}//`;
        row.querySelector(".sub").textContent = justDomain ?
          (keyStyle === "full" || keyStyle == "unsafe"
            ? "" : "…")
            : hostname.substring(0, hostname.length - domain.length);

        row.querySelector(".domain").textContent = domain;
        row.querySelector(".path").textContent = siteMatch.length > url.origin.length ? url.pathname : "";
      } else {
        row._label = siteMatch;
        urlContainer.querySelector(".full-address").textContent = siteMatch;
      }
      let httpsOnly = row.querySelector("input.https-only");
      httpsOnly.checked = keyStyle === "full" || keyStyle === "secure";

      let presets = row.querySelectorAll("input.preset");
      let idSuffix = `-${this.uiCount}-${sitesCount}`;
      for (let p of presets) {
        p.id = `${p.value}${idSuffix}`;
        p.name = `preset${idSuffix}`;
        let label = p.nextElementSibling;
        label.setAttribute("for", p.id);
        let temp = p.parentNode.querySelector("input.temp");
        if (temp) {
          temp.id = `temp-${p.id}`;
          label = temp.nextElementSibling;
          label.setAttribute("for", temp.id);
        }
      }

      let getPresetName = perms => {
        let presetName = "CUSTOM";
        for (let p of ["TRUSTED", "UNTRUSTED", "DEFAULT"]) {
          let preset = policy[p];
          switch (perms) {
            case preset:
              presetName = p;
              break;
            case preset.tempTwin:
              presetName = `T_${p}`;
              if (!presetName in UI.presets) {
                presetName = p;
              }
              break;
            }
        }
        return presetName;
      }

      let presetName = getPresetName(perms);
      if (overrideDefault) {
        let overrideName = getPresetName(overrideDefault.perms);
        if (overrideName) {
          let override = row.querySelector(`.presets input[value="${overrideName}"]`);
          if (override) {
            let def = row.querySelector(`.presets input[value="DEFAULT"]`);
            if (def && def !== override) {
              let label = def.nextElementSibling;
              label.title = def.title = `${override.title} (${overrideDefault.siteMatch})`;
              label.textContent = override.nextElementSibling.textContent + "*";
              label.classList.toggle("override", true);
              def.dataset.override = overrideName;
              def.style.backgroundImage = window.getComputedStyle(override, null).backgroundImage;
            }
          }
        }
      }

      let tempFirst = true; // TODO: make it a preference
      let unsafeMatch = keyStyle !== "secure" && keyStyle !== "full";
      if (presetName === "DEFAULT" && (tempFirst || unsafeMatch)) {
        // prioritize temporary privileges over permanent
        for (let p of TEMP_PRESETS) {
          if (p in this.presets && (unsafeMatch || tempFirst && p === "TRUSTED")) {
            row.querySelector(`.presets input[value="${p}"]`).parentNode.querySelector("input.temp").checked = true;
            perms = policy.TRUSTED.tempTwin;
          }
        }
      }
      let preset = row.querySelector(`.presets input[value="${presetName}"]`);
      if (!preset) {
        debug(`Preset %s not found in %s!`, presetName, row.innerHTML);
      } else {
        preset.checked = true;
        row.dataset.preset = row._preset = presetName;
        if (TEMP_PRESETS.includes(presetName)) {
          let temp = preset.parentNode.querySelector("input.temp");
          if (temp) {
            temp.checked = perms.temp;
          }
        }
        preset.disabled = false;
      }
      return row;
    }

    append(site, siteMatch, perms, contextMatch) {
      this.table.appendChild(this.createSiteRow(...arguments));
    }

    toggleSecure(row, secure = !!row.querySelector("https-only:checked")) {
      let site = row.siteMatch;
      site = site.replace(/^https?:/, secure ? "https:" : "http:");
      if (site === row.siteMatch) {
        site = Sites.toggleSecureDomainKey(site, secure);
      }
      if (site !== row.siteMatch) {
        this.customize(null);
        let focused = document.activeElement;
        let {policy} = UI;
        policy.set(row.siteMatch, policy.DEFAULT);
        policy.set(site, row.perms);
        for(let r of this.allSiteRows()) {
          if (r !== row && r.siteMatch === site && r.contextMatch === row.contextMatch) {
            r.remove();
          }
        }
        let newRow = this.createSiteRow(site, site, row.perms, row.contextMatch, row.sitesCount);
        row.parentNode.replaceChild(newRow, row);
        if (focused) {
          let selector = focused.matches(".preset[value]") ?
              `.preset[value="${focused.value}"]` : ".https-only";
          newRow.querySelector(selector).focus();
        }
      }
    }

    highlight(key) {
      key = Sites.toExternal(key);
      for (let r of this.allSiteRows()) {
        if (r.querySelector(".full-address").textContent.trim().includes(key)) {
          let url = r.lastElementChild;
          url.style.transition = r.style.transition = "none";
          r.style.backgroundColor = "#850";
          url.style.transform = "scale(2)";
          r.querySelector("input.preset:checked").focus();
          window.setTimeout(() => {
              r.style.transition = "1s background-color";
              url.style.transition = "1s transform";
              r.style.backgroundColor = "";
              url.style.transform = "none";
              r.scrollIntoView();
          }, 50);
        }
      }
    }

    filterSites(key) {
      key = Sites.toExternal(key);
      for (let r of this.allSiteRows()) {
        if (r.querySelector(".full-address").textContent.trim().includes(key)) {
          r.style.display = "";
        } else {
          r.style.display = "none";
        }
      }
    }
  }

  return UI;
})();
