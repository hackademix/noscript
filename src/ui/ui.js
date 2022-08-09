/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
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
var UI = (() => {

  var UI = {
    initialized: false,
    isBrowserAction: false,

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
        "/nscl/common/Messages.js",
        "/nscl/lib/punycode.js",
        "/nscl/common/tld.js",
        "/nscl/common/Sites.js",
        "/nscl/common/Permissions.js",
        "/nscl/common/Policy.js",
      ];
      this.mobile = UA.mobile;
      let root = document.documentElement;
      if (this.mobile) {
        root.classList.add("mobile");
      }
      await include(scripts);

      let inited = new Promise(resolve => {
        Messages.addHandler({
          async settings(m) {
            if (UI.tabId !== m.tabId) return;
            UI.policy = new Policy(m.policy);
            UI.snapshot = UI.policy.snapshot;
            UI.seen = m.seen;
            UI.unrestrictedTab = m.unrestrictedTab;
            UI.xssUserChoices = m.xssUserChoices;
            UI.xssBlockedInTab = m.xssBlockedInTab;
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
            if (UI.tabId === -1 || UI.xssBlockedInTab) UI.createXSSChoiceManager();
          }
        });
        UI.pullSettings();
      });

      await inited;

      this.initialized = true;
      debug("Imported", Policy);
    },
    async pullSettings() {
      Messages.send("broadcastSettings", {tabId: UI.tabId});
    },
    async updateSettings({policy, xssUserChoices, unrestrictedTab, local, sync, reloadAffected, command}) {
      if (policy) policy = policy.dry(true);
      return await Messages.send("updateSettings", {
        policy,
        xssUserChoices,
        unrestrictedTab,
        local,
        sync,
        reloadAffected,
        tabId: UI.tabId,
        command
      });
    },

    async exportSettings() {
      return await Messages.send("exportSettings");
    },
    async importSettings(data) {
      return await Messages.send("importSettings", {data});
    },

    async revokeTemp(reloadAffected = false) {
      let policy = this.policy;
      Policy.hydrate(policy.dry(), policy);
      if (this.isDirty(true)) {
        await this.updateSettings({policy, reloadAffected});
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

    wireChoice(name, storage = "sync", onchange) {
      let inputs = document.querySelectorAll(`input[type=radio][name="${name}"]`);
      if (inputs.length === 0) {
        error(`Radio button w/ name "${name}" not found.`);
        return;
      }
      if (typeof storage === "function") {
        (async() => {
          let value = await storage(null);
          for (let i of inputs) {
            i.onchange = e => storage(i);
            i.checked = value === i.value;
          }
        })();
      } else {
        let obj = UI[storage];
        let value = obj[name];
        for (let i of inputs) {
          if (i.value === value) i.checked = true;
          if (onchange) onchange(i);
          i.onchange = async () => {
            obj[name] = i.value;
            await UI.updateSettings({[storage]: obj});
            if (onchange) onchange(i);
          }
        }
      }
    },

    wireOption(name, storage = "sync", onchange) {
      let input = document.querySelector(`#opt-${name}`);
      if (!input) {
        error(`Checkbox w/ id "opt-${name}" not found.`);
        return;
      }
      if (typeof storage === "function") {
        input.onchange = e => storage(input);
        (async () => {
          input.checked = await storage(null);
        })();
      } else {
        let obj = UI[storage];
        input.checked = obj[name];
        if (onchange) onchange(input);
        input.onchange = async () => {
          obj[name] = input.checked;
          await UI.updateSettings({[storage]: obj});
          if (onchange) onchange(input);
        }
      }
      return input;
    },

    hilite(el) {
      el.classList.add("hilite");
      window.setTimeout(() => {
          el.classList.remove("hilite");
          el.classList.add("hilite-end");
          el.scrollIntoView();
          window.setTimeout(() => {
            el.classList.remove("hilite-end");
          }, 1000)
      }, 50);
    },

    createXSSChoiceManager(parent = "#xssChoices") {
      if (!UA.isMozilla) return;
      let choicesUI = document.querySelector(parent);
      if (!choicesUI) return;
      choicesUI.classList.remove("populated");
      let choices = Object.entries(UI.xssUserChoices);
      let choiceKeys = UI.xssBlockedInTab;
      if (choiceKeys) {
        choices = choices.filter(([key,])=> choiceKeys.includes(key));
      }
      if (!choices || Object.keys(choices).length === 0) {
        return;
      }

      choicesUI.classList.add("populated");

      choices.sort((a, b) => {
        let x = a.join("|"), y = b.join("|");
        return x < y ? -1 : x > y ? 1 : 0;
      });
      let list = choicesUI.querySelector("select") || choicesUI.appendChild(document.createElement("select"));
      list.size = Math.min(choices.length, 6);
      list.multiple = true;
      for (let o of list.options) {
        list.remove(o);
      }
      for (let [originKey, choice] of choices) {
        let [source, destOrigin] = originKey.split(">");
        let opt = document.createElement("option");
        opt.className = choice;
        opt.value = originKey;
        let block = choice === "block";
        opt.defaultSelected = block;
        opt.text = _(`XSS_optAlways${block ? "Block" : "Allow"}`, [source || "[...]", destOrigin]);
        list.add(opt);
      }
      let button = choicesUI.querySelector("button");
      if (!button) {
        button = choicesUI.appendChild(document.createElement("button"));
        button.textContent = _("XSS_clearUserChoices");
      }
      (list.onchange = () => {
        button.disabled = list.selectedOptions.length === 0;
      })();
      button.onclick = () => {
        let xssUserChoices = UI.xssUserChoices;
        for (let o of [...list.selectedOptions]) {
          delete xssUserChoices[o.value];
          o.remove();
        }
        let reloadAffected = false;
        if (list.options.length === 0) {
          choicesUI.classList.remove("populated");
          reloadAffected = true;
        }
        UI.updateSettings({
          xssUserChoices,
          reloadAffected,
        });
      };
    }
  };

  var HighContrast = {
    css: null,
    async init() {
      this.widget = UI.wireOption("highContrast", "local", o => {
        UI.highContrast = o.checked;
        this.toggle();
      });
      await this.toggle();
    },
    async toggle() {
      let hc = "highContrast" in UI ? UI.highContrast : await this.detect();
      if (UI.toolbarInit) UI.toolbarInit();
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
    <fieldset>
    <legend class="capsContext">
      <label></label>
      <div>
      <select><option>ANY SITE</option></select>
      <button class="reset" disabled>Reset</button>
      </div>
    </legend>
    <div class="caps">
    <span class="cap">
      <input class="cap" type="checkbox" value="script" />
      <label class="cap">script</label>
    </span>
    </div>

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

        this.correctSize(presets);
      }

      // URL
      {
        let [input, label] = row.querySelectorAll("input.https-only, label.https-only");
        input.title = label.title = label.textContent = _("httpsOnly");
      }

      // CUSTOMIZER ROW
      {
        let [customizer, capsContext, cap, capInput, capLabel] = table.querySelectorAll(".customizer, .capsContext, span.cap, input.cap, label.cap");
        row._customizer = customizer;
        customizer.remove();
        customizer.capsContext = capsContext;
        let capParent = cap.parentNode;
        capParent.removeChild(cap);
        let idSuffix = UI.Sites.count;
        for (let capability of Permissions.ALL) {
          capInput.id = `capability-${capability}-${idSuffix}`
          capLabel.setAttribute("for", capInput.id);
          capInput.value = capability;
          capInput.title = capLabel.textContent = _(`cap_${capability}`) || capability.replace(/_/g, ' ');
          let clone = capParent.appendChild(cap.cloneNode(true));
          clone.classList.add(capability);
        }
      }

      // debug(table.outerHTML);
      return row;
    }

    correctSize(presets) {
      if (this.sizeCorrected) return;
      this.sizeCorrected = true;
      // adapt button to label if needed
      let sizer = document.createElement("div");
      sizer.id = "presets-sizer";
      sizer.classList.add("sites");
      sizer.appendChild(presets.cloneNode(true));
      document.body.appendChild(sizer);
      let labelWidth = 0;
      let biggest = "";
      for (let l of sizer.querySelectorAll("label.preset")) {
        let lw = l.offsetWidth;
        if (lw > labelWidth) {
          labelWidth = lw;
          biggest = l.textContent;
        }
      }
      this.parentNode.style.setProperty("--preset-label-width", (labelWidth) + "px");
      sizer.remove();
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
        let {policy} = UI;
        if (!row._originalPerms) {
          row._originalPerms = row.perms.clone();
          Object.defineProperty(row, "permissionsChanged", {
            get() {
              return this.perms && !this.perms.sameAs(this._originalPerms);
            }
          });
        }
        if (target.matches(".capsContext select")) {
          let opt = target.querySelector("option:checked");
          if (!opt) return;
          let context = opt.value;
          if (context === "*") context = null;
          ({siteMatch, perms, contextMatch} = policy.get(siteMatch, context));
          if (!context) {
            row._customPerms = perms;
          } else if (contextMatch !== context) {
            let temp = row.perms.temp || UI.forceIncognito;
            perms = new Permissions(new Set(row.perms.capabilities), temp);
            row.perms.contextual.set(context, perms);
            fireOnChange(this, row);
          }
          row.perms = perms;
          row.siteMatch = siteMatch;
          row.contextMatch = context;
          this.setupCaps(perms, preset, row);
          tempToggle.checked = perms.temp;
          return;
        }


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
        fireOnChange(this, row);
      } else if (!(isCap || isTemp || customizer) && ev.type === "click") {
        this.customize(row.perms, preset, row);
      }
    }

    setupCaps(perms, preset, row) {
      let immutable = Permissions.IMMUTABLE[preset.value] || {};
      let customizer = this.rowTemplate._customizer;
      customizer.lastInput = null;
      for (let input of customizer.querySelectorAll("input")) {
        let type = input.value;
        if (type in immutable) {
          input.disabled = true;
          input.checked = immutable[type];
        } else {
          input.checked = perms.allowing(type);
          input.disabled = false;
          customizer.lastInput = input;
        }
        input.parentNode.classList.toggle("needed", this.siteNeeds(row._site, type));
      }
    }

    customize(perms, preset, row) {
      let customizer = this.rowTemplate._customizer;
      if (!preset) {
        preset = customizer._preset;
        delete customizer._preset;
      }
      debug("Customize preset %s (%o) - Dirty: %s", preset && preset.value, perms, this.dirty);
      for(let r of this.table.querySelectorAll("tr.customizing")) {
        r.classList.toggle("customizing", false);
      }
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
      this.setupCaps(perms, preset, row);

      customizer.classList.toggle("closed", false);
      let temp = preset.parentNode.querySelector("input.temp");
      let contextual = !!temp;
      customizer.classList.toggle("contextual", contextual);
      let [ctxLabel, ctxSelect, ctxReset] = customizer.capsContext.querySelectorAll("label, select, .reset");
      ctxLabel.textContent = _(contextual ? "capsContext" : "caps");
      ctxReset.textContent = _("Reset");
      if (contextual) {
        // contextual settings
        let entry = (value, label = value) => {
          let opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          return opt;
        }
        let toLabel = site => {
          let label = Sites.toExternal(site);
          return label.includes(":") ? label : `…${label}`;
        };
        for (let child; child = ctxSelect.firstChild;) child.remove();
        ctxSelect.appendChild(entry("*", _("anySite")));
        if (this.mainDomain) {
          let key = Sites.optimalKey(this.mainUrl);
          ctxSelect.appendChild(entry(key, toLabel(key))).selected = key === row.contextMatch;
        } else {
          if (!row._customPerms) row._customPerms = row.perms;
          let ctxSites = row._customPerms.contextual;
          if (ctxSites) {
            for (let [site, ctxPerms] of ctxSites.entries()) {
              ctxSelect.appendChild(entry(site, toLabel(site))).selected = perms === ctxPerms;
            }
          }
        }
        let handleSelection = () => {
          let selected = ctxSelect.querySelector("option:checked");
          ctxReset.disabled = !(selected && selected.value !== "*");
          ctxReset.onclick = () => {
            let perms = UI.policy.get(row.siteMatch).perms;
            perms.contextual.delete(row.contextMatch);
            fireOnChange(this, row);
            selected.previousElementSibling.selected = true;
            if (!this.mainDomain) selected.remove();
            ctxSelect.dispatchEvent(new Event("change"));
          }
        }
        ctxSelect.onchange = e => {
          let caps = customizer.querySelector(".caps");
          let pageTurn = caps.cloneNode(true);
          let s = pageTurn.style;
          s.top = `${caps.offsetTop}px`;
          s.left =`${caps.offsetLeft}px`;
          s.width = `${caps.offsetWidth}px`;
          s.height = `${caps.offsetHeight}px`;
          pageTurn.classList.add("pageTurn");
          caps.parentNode.appendChild(pageTurn);
          setTimeout(() => pageTurn.classList.add("endgame"), 1);
          setTimeout(() => pageTurn.remove(), 500);
          handleSelection();
        }

        handleSelection();
      }

      row.parentNode.insertBefore(customizer, row.nextElementSibling);
      customizer.onkeydown = e => {
        if (e.shiftKey) return true;
        switch(e.code) {
          case "Tab":
            if (document.activeElement === customizer.lastInput) {
              if (temp) {
                temp.tabIndex = "0";
                temp.onblur = () => this.customize(null);
                setTimeout(() => temp.tabIndex = "-1", 50);
                preset.focus();
              }
            }
            return true;
          case "ArrowUp":
            if (document.activeElement === ctxSelect)
              return; // avoid closing the customizer on context selection change
          case "ArrowLeft":
          case "ArrowRight":
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
            if (temp) temp.checked = !temp.checked || UI.forceIncognito;
        }
      }
      window.setTimeout(() => customizer.querySelector("input:not(:disabled)").focus(), 50);
    }

    render(sites = this.sites, sorter = this.sorter) {
      let parentNode = this.parentNode;
      if (sites) this._populate(sites, sorter);

      parentNode.innerHTML = "";
      parentNode.appendChild(this.fragment);
      let root = parentNode.querySelector("table.sites");
      if (!root.wiredBy) {
        root.addEventListener("keydown", e => this._keyNavHandler(e), true);
        root.addEventListener("keyup", e => {
          // we use a keyup listener to open the customizer from other presets
          // because space repetition may lead to unintendedly "click" on the
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
      if (!focused || e.ctrlKey || e.metaKey) return;
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
      let hasTemp = false;
      if (sites instanceof Sites) {
        for (let [site, perms] of sites) {
          this.append(site, site, perms);
          if (!hasTemp) hasTemp = perms.temp;
        }
      } else {
        let top = Sites.optimalKey(this.mainUrl);
        for (let site of sites) {
          let context = top;
          if (site.site) {
            site = site.site;
            context = site.context;
          }
          let {siteMatch, perms, contextMatch} = UI.policy.get(site, context);
          this.append(site, siteMatch, perms, contextMatch);
          if (!hasTemp) hasTemp = perms.temp;
        }
        this.sites = sites;
      }
      this.hasTemp = hasTemp;
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

      let {hostname} = url;
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
      if (domain) { // "normal" URL
        let justDomain = hostname === domain;
        let domainEntry = secure || domain === site;
        let unicodeDomain = row.domain = punycode.toUnicode(domain);
        row._label =  domainEntry ? `.${unicodeDomain}` : Sites.toExternal(site);
        row.querySelector(".protocol").textContent = `${url.protocol}//`;
        row.querySelector(".sub").textContent = justDomain ?
          (keyStyle === "full" || keyStyle == "unsafe"
            ? "" : "…")
            : punycode.toUnicode(hostname.substring(0, hostname.length - domain.length));

        row.querySelector(".domain").textContent = unicodeDomain;
        row.querySelector(".path").textContent = siteMatch.length > url.origin.length ? url.pathname : "";
      } else {
        urlContainer.querySelector(".full-address").textContent =
          row._label = row.domain = siteMatch;
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

    hilite(key) {
      key = Sites.toExternal(key);
      for (let r of this.allSiteRows()) {
        if (key === r.siteMatch) {
          UI.hilite(r);
          r.querySelector("input.preset:checked").focus();
          break;
        }
      }
    }

    filterSites(key) {
      key = Sites.toExternal(key);
      for (let r of this.allSiteRows()) {
        if (r.querySelector(".full-address").textContent.trim().includes(key)) {
          r.classList.remove("filtered");
        } else {
          r.classList.add("filtered");
        }
      }
    }
  }

  return UI;
})();
