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

document.querySelector("#version").textContent = _("Version",
  browser.runtime.getManifest().version);

(async () => {

  await UI.init();

  let policy = UI.policy;

  // simple general options

  let opt = UI.wireOption;

  opt("global", o => {
    if (o) {
      policy.enforced = !o.checked;
      UI.updateSettings({policy});
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
      UI.updateSettings({policy});
    }
    return policy.autoAllowTop;
  });

  opt("cascadeRestrictions");

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
    if (checked) updateRawPolicyEditor();
  });

  UI.wireChoice("TabGuardMode");

  document.querySelector("#tgForgetButton").onclick = e => {
    e.target.disabled = true;
    UI.updateSettings({command: "tg-forget"});
  };

  // Appearance

  opt("showCountBadge", "local");
  opt("showCtxMenuItem", "local");
  opt("showFullAddresses", "local");

  UI.wireChoice("theme", o => Themes.setup(o && o.value) );

  opt("vintageTheme", async o => await (o ? Themes.setVintage(o.checked) : Themes.isVintage()));

  // PRESET CUSTOMIZER
  {
    let parent = document.getElementById("presets");
    let presetsUI = new UI.Sites(parent,
      {"DEFAULT": true, "TRUSTED": true, "UNTRUSTED": true});

    presetsUI.render([""]);
    window.setTimeout(() => {
      let def = parent.querySelector('input.preset[value="DEFAULT"]');
      def.checked = true;
      def.click();
    }, 10);
  }

  // SITES UI
  let sitesUI = new UI.Sites(document.getElementById("sites"));
  UI.onSettings = () => {
    policy = UI.policy;
    sitesUI.render(policy.sites);
  }
  {
    sitesUI.onChange = () => {
      if (UI.local.debug) {
        updateRawPolicyEditor();
      }
    };
    sitesUI.render(policy.sites);

    let newSiteForm = document.querySelector("#form-newsite");
    let newSiteInput = newSiteForm.newsite;
    let button = newSiteForm.querySelector("button");
    let canAdd = s => {
      let match = policy.get(s).siteMatch;
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
        policy.set(site, policy.TRUSTED);
        UI.updateSettings({policy});
        newSiteInput.value = "";
        sitesUI.render(policy.sites);
        sitesUI.hilite(site);
        sitesUI.onChange();
      }
    }, true);
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
})();
