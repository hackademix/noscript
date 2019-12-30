'use strict';
(async () => {

  await UI.init();

  let policy = UI.policy;

  let version = browser.runtime.getManifest().version;
  document.querySelector("#version").textContent = _("Version", version);
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

  {
    document.querySelector("#btn-reset").addEventListener("click", async () => {
      if (confirm(_("reset_warning"))) {
        policy = new Policy();
        await UI.updateSettings({policy, local: null, sync: null, xssUserChoices: {}});
        window.location.reload();
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
    let button = document.querySelector("#btn-delete-xss-choices");
    let choices = UI.xssUserChoices;
    button.disabled = !choices || Object.keys(choices).length === 0;
    button.onclick = () => {
      UI.updateSettings({
        xssUserChoices: {}
      });
      button.disabled = true
    };

  }

  opt("clearclick");
  opt("debug", "local", b => {
    document.body.classList.toggle("debug", b);
    if (b) updateRawPolicyEditor();
  });

  // Appearance

  opt("showCountBadge", "local");
  opt("showCtxMenuItem", "local");
  opt("showFullAddresses", "local");

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
  {
    sitesUI.onChange = () => {
      if (UI.local.debug) {
        updateRawPolicyEditor();
      }
    };
    let sites = policy.sites;
    sitesUI.render(sites);

    let newSiteForm = document.querySelector("#form-newsite");
    let newSiteInput = newSiteForm.newsite;
    let button = newSiteForm.querySelector("button");
    let canAdd = s => policy.get(s).siteMatch === null;

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
        sitesUI.highlight(site);
        sitesUI.onChange();
      }
    }, true);
  }


  // UTILITY FUNCTIONS

  function updateRawPolicyEditor() {
    if (!UI.local.debug) return;

    // RAW POLICY EDITING (debug only)
    let policyEditor = document.getElementById("policy");
    policyEditor.value = JSON.stringify(policy.dry(true), null, 2);
    if (!policyEditor.onchange) policyEditor.onchange = (e) => {
      let ed = e.currentTarget
      try {
        policy = new Policy(JSON.parse(ed.value));
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
