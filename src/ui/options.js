/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
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

document.querySelector("#version").textContent = _("Version",
  browser.runtime.getManifest().version);

(async () => {

  await UI.init();

  let policy = UI.policy;
  let contextStore = UI.contextStore;

  // simple general options

  let opt = UI.wireOption;

  opt("global", o => {
    if (o) {
      policy.enforced = !o.checked;
      contextStore.setAll({"enforced": !o.checked});
      UI.updateSettings({policy, contextStore});
    }
    let {enforced} = policy;
    let disabled = !enforced;
    for (let e of document.querySelectorAll(".enforcement_required")) {
      e.disabled = disabled;
    }
    return disabled;
  });

  opt("enforceOnRestart", "local");

  opt("auto", o => {
    if (o) {
      policy.autoAllowTop = o.checked;
      contextStore.setAll({"autoAllowTop": o.checked});
      UI.updateSettings({policy, contextStore});
    }
    return policy.autoAllowTop;
  });

  opt("cascadeRestrictions");

  opt("containers", async o => {
    if (o) {
      contextStore.enabled = o.checked;
      await contextStore.updateContainers(policy);
      UI.updateSettings({contextStore});
    }
    updateContainersEnabled();
    return contextStore.enabled;
  })

  opt("xss");

  opt("overrideTorBrowserPolicy");

  opt("amnesticUpdates", "local");

  {
    document.querySelector("#btn-reset").addEventListener("click", async ev => {
      if (confirm(_("reset_warning"))) {
        ev.target.disabled = true;
        document.querySelector("#main-tabs").style.visibility = "hidden";
        await UI.updateSettings({local: null, sync: null, xssUserChoices: {}});
      }
    });

    let fileInput = document.querySelector("#file-import");
    fileInput.onchange = () => {
      let fr = new FileReader();
      fr.onload = async () => {
        try {
          await UI.importSettings(fr.result);
        } catch (e) {
          error(e, "Importing settings %s", fr.result);
          alert(e);
          return;
        }
        location.reload();
      }
      fr.readAsText(fileInput.files[0]);
    }

    document.querySelector("#btn-import").addEventListener("click", async e => {
      fileInput.focus();
      fileInput.click();
      e.target.focus();
    });

    document.querySelector("#btn-export").addEventListener("click", async e => {
      let button = e.target;
      button.disabled = true;
      let settings = await UI.exportSettings();
      let id = "noscriptExportFrame";
      let f = document.getElementById(id);
      if (f) f.remove();
      f = document.createElement("iframe");
      f.id = id;
      f.srcdoc = `<a download="noscript_data.txt" target="_blank">NoScript Export</a>`;
      f.style.position = "fixed";
      f.style.top = "-999px";
      f.style.height = "1px";
      f.onload = () => {
        let w = f.contentWindow;
        let a = w.document.querySelector("a");
        a.href = w.URL.createObjectURL(new w.Blob([settings], {
          type: "text/plain"
        }));
        a.click();
        setTimeout(() => {
          button.disabled = false;
        }, 1000);

      };
      document.body.appendChild(f);
    });
  }

  {
    let a = document.querySelector("#xssFaq a");
    a.onclick = e => {
      e.preventDefault();
      browser.tabs.create({
        url: a.href
      });
    }
  }

  opt("clearclick");
  opt("debug", "local", o => {
    let {checked} = o;
    document.body.classList.toggle("debug", checked);
    if (checked) {
      updateRawPolicyEditor();
      updateRawContextStoreEditor();
    }
  });

  UI.wireChoice("TabGuardMode");
  UI.wireChoice("TabGuardPrompt");

  document.querySelector("#tgForgetButton").onclick = e => {
    e.target.disabled = true;
    UI.updateSettings({command: "tg-forget"});
  };

  // Appearance

  opt("showCountBadge", "local");
  opt("showCtxMenuItem", "local");
  opt("showFullAddresses", "local");
  opt("showProbePlaceholders", "local");

  UI.wireChoice("theme", async o => await Themes.setup(o?.value) );
  opt("vintageTheme", async o => await (o ? Themes.setVintage(o.checked) : Themes.isVintage()));
  addEventListener("NoScriptThemeChanged", ({detail}) => {
    if ("theme" in detail) {
      for (let i of UI.getChoiceElements("theme")) {
        if (i.value === detail.theme) {
          i.checked = true;
          break;
        }
      }
    }
    if (Themes.VINTAGE in detail) {
      UI.getOptionElement("vintageTheme").checked = !!detail[Themes.VINTAGE];
    }
  });


  // PRESET CUSTOMIZER
  {
    let parent = document.getElementById("presets");
    let presetsUI = new UI.Sites(parent,
      {"DEFAULT": true, "TRUSTED": true, "UNTRUSTED": true});
    presetsUI.onChange = () => {
      if (policy && contextStore) {  // contextStore presets always copy default policy's
        contextStore.updatePresets(policy);
        UI.updateSettings({policy, contextStore});
      }
    }

    presetsUI.render([""]);
    window.setTimeout(() => {
      let def = parent.querySelector('input.preset[value="DEFAULT"]');
      def.checked = true;
      def.click();
    }, 10);
  }

  // SITES UI
  let sitesUI = new UI.Sites(document.getElementById("sites"));
  let containerSelect = document.querySelector("#select-container");
  let containerCopy = document.querySelector("#copy-container");
  var cookieStoreId = containerSelect.value;
  var currentPolicy = await UI.getPolicy(cookieStoreId);

  function updateContainersEnabled() {
    let containersEnabled = Boolean(contextStore.enabled && browser.contextualIdentities);
    document.querySelector("#opt-containers").disabled = !browser.contextualIdentities;
    document.querySelector("#opt-containers").checked = contextStore.enabled;
    document.querySelector("#select-container").hidden = !containersEnabled;
    document.querySelector("#select-container-label").hidden = !containersEnabled;
    document.querySelector("#per-site-buttons").style.display = containersEnabled? "flex" : "none";
  }
  updateContainersEnabled();

  async function changeContainer() {
    cookieStoreId = containerSelect.value;
    currentPolicy = await UI.getPolicy(cookieStoreId);
    debug("container change", cookieStoreId, currentPolicy);
    sitesUI.clear()
    sitesUI.policy = currentPolicy;
    sitesUI.render(currentPolicy.sites);
  }
  containerSelect.onchange = changeContainer;

  async function copyContainer() {
    cookieStoreId = containerSelect.value;
    if (cookieStoreId == "default") {
      alert("Cannot replace the default policy.")
      containerCopy.value = "blank";
      return;
    }
    let copyCookieStoreId = containerCopy.value;
    let copyContainerName = containerCopy.options[containerCopy.selectedIndex].text;
    let copyPolicy = await UI.getPolicy(copyCookieStoreId);
    if (confirm(`Copying permissions from "${copyContainerName}".\n` + "All site permissions for this container will be removed.\nThis action cannot be reverted.\nDo you want to continue?")) {
      sitesUI.clear()
      currentPolicy = await UI.replacePolicy(cookieStoreId, new Policy(copyPolicy.dry(true)));
      await UI.updateSettings({policy, contextStore});
      sitesUI.policy = currentPolicy;
      sitesUI.render(currentPolicy.sites);
    }
    containerCopy.value = "blank";
  }
  containerCopy.onchange = copyContainer;

  var containers = [];
  async function updateContainerOptions() {
    let newContainers = [{cookieStoreId: "default", name: "Default"},];
    let identities = browser.contextualIdentities && await browser.contextualIdentities.query({});
    if (identities) {
      identities.forEach(({cookieStoreId, name}) => {
        newContainers.push({cookieStoreId, name});
      })
    }
    if (JSON.stringify(newContainers) == JSON.stringify(containers)) return;
    containers = newContainers;
    var container_options = ""
    for (var container of containers) {
      container_options += "<option value=" + container.cookieStoreId + ">" + container.name + "</option>"
    }
    containerSelect.innerHTML = container_options;
    containerSelect.value = cookieStoreId;
    containerCopy.innerHTML = "<option value=blank></option>" + container_options;
  }
  containerSelect.onfocus = updateContainerOptions;
  containerCopy.onfocus = updateContainerOptions;
  if (contextStore.enabled) await updateContainerOptions();

  UI.onSettings = async () => {
    currentPolicy = await UI.getPolicy(cookieStoreId);
    sitesUI.render(currentPolicy.sites);
  }
  {
    sitesUI.onChange = () => {
      if (UI.local.debug) {
        updateRawPolicyEditor();
        updateRawContextStoreEditor();
      }
    };
    sitesUI.render(currentPolicy.sites);

    let newSiteForm = document.querySelector("#form-newsite");
    let newSiteInput = newSiteForm.newsite;
    let button = newSiteForm.querySelector("button");
    let canAdd = s => {
      let match = currentPolicy.get(s).siteMatch;
      return match === null || s.length > match.length;
    }

    let validate = () => {
      let site = newSiteInput.value.trim();
      button.disabled = !(Sites.isValid(site) && canAdd(site));
      sitesUI.filterSites(site);
    }
    validate();
    newSiteInput.addEventListener("input", validate);

    newSiteForm.addEventListener("submit", e => {
      e.preventDefault();
      e.stopPropagation();
      let site = newSiteInput.value.trim();
      let valid = Sites.isValid(site);
      if (valid && canAdd(site)) {
        currentPolicy.set(site, currentPolicy.TRUSTED);
        UI.updateSettings({policy, contextStore});
        newSiteInput.value = "";
        sitesUI.render(currentPolicy.sites);
        sitesUI.hilite(site);
        sitesUI.onChange();
      }
    }, true);

    document.querySelector("#btn-clear-container").addEventListener("click", async ev => {
      if (confirm("All site permissions for this container will be removed.\nThis action cannot be reverted.\nDo you want to continue?")) {
        sitesUI.clear()
        currentPolicy.sites = Sites.hydrate({});
        await UI.updateSettings({policy, contextStore});
        sitesUI.render(currentPolicy.sites);
      }
    });
  }

  window.setTimeout(() => {
    // focus and/or hilite elements based on query string
    let params = new URLSearchParams(location.search);
    let el = key => {
      let selector = params.get(key);
      return selector && document.querySelector(selector);
    }

    let focusElement = el("focus");
    if (focusElement) focusElement.focus();

    let hiliteElement = el("hilite");
    if (hiliteElement) UI.hilite(hiliteElement);
  }, 1000);

  // UTILITY FUNCTIONS

  function updateRawPolicyEditor() {
    if (!UI.local.debug) return;

    // RAW POLICY EDITING (debug only)
    let policyEditor = document.getElementById("policy");
    policyEditor.value = JSON.stringify(policy.dry(true), null, 2);
    if (!policyEditor.onchange) policyEditor.onchange = (e) => {
      let ed = e.currentTarget
      try {
        UI.policy = policy = new Policy(JSON.parse(ed.value));
        UI.updateSettings({policy});
        containerSelect.value = "default";
        sitesUI.render(policy.sites);
        ed.className = "";
        document.getElementById("policy-error").textContent = "";
      } catch (e) {
        error(e);
        ed.className = "error";
        document.getElementById("policy-error").textContent = e.message;
      }
    }
  }

  function updateRawContextStoreEditor() {
    if (!UI.local.debug) return;

    // RAW POLICY EDITING (debug only)
    if (!browser.contextualIdentities) {
      document.querySelector("#edit-context-store").style.display = "none";
      return;
    }
    let contextStoreEditor = document.getElementById("context-store");
    contextStoreEditor.value = JSON.stringify(contextStore.dry(true), null, 2);
    if (!contextStoreEditor.onchange) contextStoreEditor.onchange = (e) => {
      let ed = e.currentTarget
      try {
        UI.contextStore = contextStore = new ContextStore(JSON.parse(ed.value));
        UI.updateSettings({contextStore});

        ed.className = "";
        document.getElementById("context-store-error").textContent = "";
      } catch (e) {
        error(e);
        ed.className = "error";
        document.getElementById("context-store-error").textContent = e.message;
      }
    }
  }
})();
