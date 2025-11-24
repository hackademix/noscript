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
(() => {
  const behaviorUI = document.getElementById("behavior");

  function showBehaviorUI(show = true) {
    document.getElementById("noscript-options").classList.toggle("hidden", show);
    behaviorUI.classList.toggle("hidden", !show);
  }

  if (UI.local.isTorBrowser) {
    showBehaviorUI(false);
    return;
  }

  const isOnboarding = document.URL.includes("onboarding");
  if (isOnboarding) {
    behaviorUI.appendChild(
      document.querySelector(".donate.button").cloneNode(true),
    );
    document.documentElement.classList.add("onboarding");
    showBehaviorUI();
  } else {
    showBehaviorUI(false);
  }
  behaviorUI.querySelector(".close")?.addEventListener("click", async (e) => {
    if (isOnboarding) {
      browser.tabs.remove((await browser.tabs.getCurrent()).id);
      return;
    }
    showBehaviorUI(false);
  });
  document.querySelector("#current-behavior").onclick = e => {
    showBehaviorUI(true);
  };

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!(e.isIntersecting && e.intersectionRatio > .5)) {
        behaviorUI.setAttribute("aria-expanded", "false");
        io.disconnect();
      }
    }
  }, { root: behaviorUI, threshold: .5 });
  for (const c of behaviorUI.getElementsByClassName("card")) {
    io.observe(c);
  }
  const opts = {};
  for (let o of ["auto", "cascadePermissions"]) {
    const el = opts[o] = UI.getOptionElement(o);
    const onchange = el.onchange;
    el.onchange = function (...args) {
      onchange(...args);
      syncFromOpts();
    }
  }
  function syncFromOpts() {
    const behavior =
      opts.auto.checked
        ? opts.cascadePermissions.checked
          ? "defaultAllow"
          : "auto"
        : UI.policy.DEFAULT.capabilities.has("script") || opts.cascadePermissions.checked
          ? "custom"
          : "defaultDeny"
      ;
    const radio = behaviorUI.querySelector(`[name=behavior][value=${behavior}]`);
    document.getElementById("current-behavior").textContent = _(radio ? `behavior_${behavior}_title` : 'Custom');
    if (radio) {
      radio.checked = true;
    } else {
      [...document.querySelectorAll("[name=behavior]::checked")].forEach(radio => radio.checked = false);
    }
  }

  syncFromOpts();
  UI.onSettings.addListener(syncFromOpts);
  document.querySelector("#presets .customizer").addEventListener("change", syncFromOpts);

  behaviorUI.addEventListener("change", async e => {
    if (e.target.name != "behavior") return;
    let auto, cascadePermissions;
    switch(e.target.value) {
      case "defaultDeny":
        auto = cascadePermissions = false;
      break;
      case "auto":
        auto = true;
        cascadePermissions = false;
      break;
      case "defaultAllow":
        auto = true;
        cascadePermissions = true;
      break;
      default:
        // should never happen
        return;
    }
    opts.cascadePermissions.checked = UI.sync.cascadePermissions = cascadePermissions;
    opts.auto.checked = UI.policy.autoAllowTop = auto;
    const settings = { sync: UI.sync };
    if (UI.policy.DEFAULT.capabilities.has("script")) {
      UI.policy.DEFAULT.capabilities.delete("script");
      settings.policy = UI.policy;
    }
    await UI.updateSettings(settings);
    syncFromOpts();
  });

})();
