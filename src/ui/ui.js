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

    async init(tabId = -1) {
      UI.tabId = tabId;
      let scripts = [
        "/ui/ui.css",
        "/lib/Messages.js",
        "/lib/punycode.js",
        "/lib/tld.js",
        "/common/Policy.js",
      ];
      this.mobile = !("windows" in browser);
      if (this.mobile) {
        document.documentElement.classList.toggle("mobile", true);
        scripts.push("/lib/fastclick.js");
      }
      await include(scripts);

      let inited = new Promise(resolve => {
        Messages.addHandler({
          async settings(m) {
            UI.policy = new Policy(m.policy);
            UI.snapshot = UI.policy.snapshot;
            UI.seen = m.seen;
            UI.unrestrictedTab = m.unrestrictedTab;
            UI.xssUserChoices = m.xssUserChoices;
            UI.local = m.local;
            UI.sync = m.sync;
            if (UI.local && !UI.local.debug) {
              debug = () => {}; // be quiet!
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
        canary.parentNode.removeChild(canary);
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
    return x > y ? 1 : x < y ? -1 : 0;
  }

  const TEMPLATE = `
    <table class="sites">
    <tr class="site">

    <td class="presets">
    <span class="preset">
      <input id="preset" class="preset" type="radio" name="preset"><label for="preset" class="preset">PRESET</label>
      <button class="options tiny">⚙</button>
      <input id="temp" class="temp" type="checkbox"><label for="temp">Temporary</input>
    </span>
    </td>

    <td class="url" data-key="secure">
    <input class="https-only" id="https-only" type="checkbox"><label for="https-only" class="https-only"></label>
    <span class="full-address">
    <span class="protocol">https://</span><span class="sub">www.</span><span class="domain">noscript.net</span><span class="path"></span>
    </span>
    </td>



    </tr>
    <tr class="customizer">
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
        let [span, input, label, options] = presets.querySelectorAll("span.preset, input.preset, label.preset, .options");
        span.remove();
        options.title = _("Options");
        for (let [preset, customizable] of Object.entries(this.presets)) {
          let messageKey = UI.presets[preset];
          input.value = preset;
          label.textContent = label.title = input.title = _(messageKey);
          let clone = span.cloneNode(true);
          clone.classList.add(preset);
          let temp = clone.querySelector(".temp");
          if (TEMP_PRESETS.includes(preset)) {
            temp.title = _("allowTemp", `(${label.title.toUpperCase()})`);
            temp.nextElementSibling.textContent = _("allowTemp", ""); // label;
          } else {
            temp.nextElementSibling.remove();
            temp.remove();
          }
          if (customizable) {
            clone.querySelector(".options").remove();
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
          capInput.title = capLabel.textContent = _(`cap_${capability}`);
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
      setTimeout(async () => {
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

      }, 100);
      UI.Sites.correctSize = () => {}; // just once, please!
    }

    allSiteRows() {
      return this.table.querySelectorAll("tr.site");
    }
    clear() {
      debug("Clearing list", this.table);

      this.template = document.createElement("template");
      this.template.innerHTML = TEMPLATE;
      this.fragment = this.template.content;
      this.table = this.fragment.querySelector("table.sites");
      this.rowTemplate = this.initRow();

      for (let r of this.allSiteRows()) {
        r.parentNode.removeChild(r);
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
      row.temp2perm = false;
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

      let policy = UI.policy;
      let {siteMatch, contextMatch, perms} = row;
      let presetValue = preset.value;
      let policyPreset = presetValue.startsWith("T_") ? policy[presetValue.substring(2)].tempTwin : policy[presetValue];

      if (policyPreset) {
        if (row.perms !== policyPreset) {
          row.temp2perm = row.perms && policyPreset.tempTwin === row.perms;
          row.perms = policyPreset;
        }
      }


      let isCap = customizer && target.matches(".cap");
      let tempToggle = preset.parentNode.querySelector("input.temp");

      if (ev.type === "change") {
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
            row.perms.temp = target.checked;
          } else {
            let temp = preset.parentNode.querySelector("input.temp").checked;
            let perms = row._customPerms ||
              (row._customPerms = new Permissions(new Set(row.perms.capabilities), temp));
            row.perms = perms;
            policy.set(siteMatch, perms);
            this.customize(perms, preset, row);
          }
        }
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
           return;
      }

      customizer._preset = preset;
      row.classList.toggle("customizing", true);
      let immutable = Permissions.IMMUTABLE[preset.value] || {};
      for (let input of customizer.querySelectorAll("input")) {
        let type = input.value;
        if (type in immutable) {
          input.disabled = true;
          input.checked = immutable[type];
        } else {
          input.checked = perms.allowing(type);
          input.disabled = false;
        }
        input.parentNode.classList.toggle("needed", this.siteNeeds(row._site, type));
        row.parentNode.insertBefore(customizer, row.nextElementSibling);
        customizer.classList.toggle("closed", false);
        customizer.onkeydown = e => {
          switch(e.keyCode) {
            case 38:
            case 8:
            e.preventDefault();
            this.onkeydown = null;
            this.customize(null);
            preset.focus();
            return false;
          }
        }
        window.setTimeout(() => customizer.querySelector("input").focus(), 50);
      }
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
        root.addEventListener("click", this, true);
        root.addEventListener("change", this, true);
        root.wiredBy = this;
      }
      return root;
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
      window.setTimeout(() => this.focus(), 50);
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
          return wrappedCompare(a, b);
        }
      }
      let rows = [...this.allSiteRows()].sort(sorter);
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
      this.table.appendChild(this.rowTemplate._customizer);
    }

    sorter(a, b) {
      return compareBy("domain", a, b) ||  compareBy("_label", a, b);
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

      let row = this.rowTemplate.cloneNode(true);
      row.sitesCount = sitesCount;
      let url;
      try {
        url = new URL(site);
      } catch (e) {
        let protocol = Sites.isSecureDomainKey(site) ? "https:" : "http:";
        let hostname = Sites.toggleSecureDomainKey(site, false);
        url = {protocol, hostname, origin: `${protocol}://${site}`, pathname: "/"};
      }

      let hostname = Sites.toExternal(url.hostname);
      let domain = tld.getDomain(hostname);

      if (!siteMatch) {
        // siteMatch = url.protocol === "https:" ? Sites.secureDomainKey(domain) : site;
        siteMatch = site;
      }
      let secure = Sites.isSecureDomainKey(siteMatch);
      let keyStyle = secure ? "secure"
        : !domain || /^\w+:/.test(siteMatch) ?
            (url.protocol === "https:" ? "full" : "unsafe")
          : domain === hostname ? "domain" : "host";

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
        let httpsOnly = row.querySelector("input.https-only");
        httpsOnly.checked = keyStyle === "full" || keyStyle === "secure";
      } else {
        row._label = siteMatch;
        urlContainer.querySelector(".full-address").textContent = siteMatch;
      }

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
      let policy = UI.policy;

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
      }
      return row;
    }

    append(site, siteMatch, perms, contextMatch) {
      this.table.appendChild(this.createSiteRow(...arguments));
    }

    toggleSecure(row, secure = !!row.querySelector("https-only:checked")) {
      this.customize(null);
      let site = row.siteMatch;
      site = site.replace(/^https?:/, secure ? "https:" : "http:");
      if (site === row.siteMatch) {
        site = Sites.toggleSecureDomainKey(site, secure);
      }
      if (site !== row.siteMatch) {
        let {policy} = UI;
        policy.set(row.siteMatch, policy.DEFAULT);
        policy.set(site, row.perms);
        for(let r of this.allSiteRows()) {
          if (r !== row && r.siteMatch === site && r.contextMatch === row.contextMatch) {
            r.parentNode.removeChild(r);
          }
        }
        let newRow = this.createSiteRow(site, site, row.perms, row.contextMatch, row.sitesCount);
        row.parentNode.replaceChild(newRow, row);
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
