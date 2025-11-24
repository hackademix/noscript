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
"use strict";
(() => {
  const behaviorUI = document.getElementById("behavior");
  const isOnboarding = document.URL.includes("onboarding");

  function showBehaviorUI(show = true) {
    document
      .getElementById("noscript-options")
      .classList.toggle("hidden", show);
    behaviorUI.classList.toggle("hidden", !show);
  }

  async function close() {
    if (isOnboarding) {
      await browser.tabs.remove((await browser.tabs.getCurrent()).id);
      return;
    }
    showBehaviorUI(false);
  }

  if (UI.local.isTorBrowser) {
    close();
  }

  if (isOnboarding) {
    behaviorUI.appendChild(
      document.querySelector(".donate.button").cloneNode(true),
    );
    document.documentElement.classList.add("onboarding");
    showBehaviorUI();
  } else {
    showBehaviorUI(false);
  }

  behaviorUI.querySelector(".close")?.addEventListener("click", close);

  const currentBehavior = document.getElementById("current-behavior");

  currentBehavior.onclick = (e) => {
    showBehaviorUI(true);
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!(e.isIntersecting && e.intersectionRatio > 0.5)) {
          behaviorUI.setAttribute("aria-expanded", "false");
          io.disconnect();
        }
      }
    },
    { root: behaviorUI, threshold: 0.5 },
  );
  for (const c of behaviorUI.getElementsByClassName("card")) {
    io.observe(c);
  }
  const opts = {};
  for (let o of ["auto", "cascadePermissions"]) {
    const el = (opts[o] = UI.getOptionElement(o));
    const onchange = el.onchange;
    el.onchange = function (...args) {
      onchange(...args);
      syncFromOpts();
    };
  }
  function syncFromOpts() {
    const behavior = opts.auto.checked
      ? opts.cascadePermissions.checked
        ? "defaultAllow"
        : "auto"
      : UI.policy.DEFAULT.capabilities.has("script") ||
          opts.cascadePermissions.checked
        ? "custom"
        : "defaultDeny";
    const radio = behaviorUI.querySelector(
      `[name=behavior][value=${behavior}]`,
    );
    currentBehavior.textContent = _(
      radio ? `behavior_${behavior}_title` : "Custom",
    );
    currentBehavior.dataset.behavior = behavior;
    if (radio) {
      radio.checked = true;
    } else {
      [...document.querySelectorAll("[name=behavior]:checked")].forEach(
        (radio) => (radio.checked = false),
      );
    }
  }

  syncFromOpts();
  UI.onSettings.addListener(syncFromOpts);
  document.querySelector("#presets").addEventListener("change", (e) => {
    if (
      e.target.matches(".cap[value=script]") &&
      document.querySelector(".customizing[data-preset='DEFAULT']")
    ) {
      syncFromOpts();
    }
  });

  behaviorUI.addEventListener("change", async (e) => {
    if (e.target.name != "behavior") return;
    const settings = { sync: UI.sync, policy: UI.policy };
    let auto, cascadePermissions;
    switch (e.target.value) {
      case "defaultDeny":
        auto = cascadePermissions = false;
        if (UI.policy.DEFAULT.capabilities.has("script")) {
          UI.policy.DEFAULT.capabilities.delete("script");
          const defaultCanScript = document.querySelector(
            "#presets .customizing[data-preset=DEFAULT] ~ .customizer .cap[value=script]",
          );
          if (defaultCanScript) {
            defaultCanScript.checked = false;
          }
        }
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
    opts.cascadePermissions.checked = UI.sync.cascadePermissions =
      cascadePermissions;
    opts.auto.checked = UI.policy.autoAllowTop = auto;
    await UI.updateSettings(settings);
    syncFromOpts();
  });
})();
