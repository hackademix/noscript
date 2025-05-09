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

var Prompts = (() => {

  var promptData;
  var backlog = [];

  Messages.addHandler({
    getPromptData() { return Prompts.promptData },
    promptDone(data) {
      let promptData = promptDataMap.get(data.id);
      if (promptData) {
        Object.assign(promptData, data).done();
      }
    }
  });

  class WindowManager {
    constructor() {
      this.currentWindow = this.currentTab = null;
      browser.windows?.onRemoved.addListener(windowId => {
        if (windowId === this.currentWindow?.id) {
          promptData?.done();
        }
      });
      browser.tabs.onRemoved.addListener(tabId => {
        if (tabId === this.currentTab?.id) {
          promptData?.done();
        }
      });
    }

    async open(data) {
      promptData = data;
      this.close();

      let url = browser.runtime.getURL("ui/prompt.html");

      if (!("windows" in browser)) {
        // Android, most likely
        this.currentTab = await browser.tabs.create({url});
        return;
      }

      let {width, height, left, top, parent } = data.features;

      let options = {
        url,
        type: "popup",
      }

      if (!parent) {
        parent = await browser.windows.getCurrent();
      }

      if (UA.isMozilla) {
        options.allowScriptsToClose = true;
      }

      const centerOnParent = bounds => {
        for (const [p, s] of [["left", "width"], ["top", "height"]]) {
          if (bounds[s] && bounds[p] === undefined) {
            bounds[p] = Math.round(parent[p] + (parent[s] - bounds[s]) / 2);
          }
        }
        return bounds;
      };

      if (width && height) {
        const bounds = { width, height, left, top };
        url += `?winbounds=${JSON.stringify(bounds)}`;
        if (parent) {
          ({ left, top } = Object.assign(options, centerOnParent(bounds)));
        }
      }

      debug("Prompt pre-opening options", options, left, top, width, height); // DEV_ONLY
      let popup = (this.currentWindow = await browser.windows.create(options));

      if (parent) {
        ({ left, top } = centerOnParent({
          width: width || popup.width,
          height: height || popup.height,
        }));
      } else {
        // use given left & top or default to auto-centering on main screen
        if (left === undefined) ({ left } = popup);
        if (top === undefined) ({ top } = popup);
      }

      debug("Prompt post-opening options", popup, options, left, top, width, height); // DEV_ONLY

      // work around for resistFingerprinting new window rounding (https://bugzilla.mozilla.org/show_bug.cgi?id=1330882)
      if (
        width &&
        height &&
        (popup.width !== width ||
          popup.height !== height ||
          popup.left !== left ||
          popup.top !== top)
      ) {
        popup = await browser.windows.update(popup.id, {
          left,
          top,
          width,
          height,
        });
        for (let attempts = 2; attempts-- > 0; ) {
          debug("Resizing", popup, { left, top, width, height }); // DEV_ONY
          popup = await browser.windows.update(popup.id, { width, height });
          if (popup.width == width && popup.height == height) {
            break;
          }
        }
      }
    }

    async close() {
      if (this.currentWindow) {
        try {
          await browser.windows.remove(this.currentWindow.id);
        } catch (e) {
        }
        this.currentWindow = null;
      } else if (this.currentTab) {
        await browser.tabs.remove(this.currentTab.id);
        this.currentTab = null;
      }
    }

    async focus() {
      if (this.currentWindow) {
        try {
          await browser.windows.update(this.currentWindow.id,
            {
              focused: true,
            }
          );
        } catch (e) {
          error(e, "Focusing popup window");
        }
      }
    }

    async validateCurrent() {
      try {
        if (this.currentTab) {
          await browser.tabs.get(this.currentTab.id);
        }
        if (this.currentWindow) {
          await browser.windows.get(this.currentWindow.id);
        }
        return promptData;
      } catch (e) {
        promptData?.done();
        return null;
      }
    }
  }

  var winMan = new WindowManager();
  var id = 0;
  var promptDataMap = new Map();
  var Prompts = {
    DEFAULTS: {
      title: "",
      message: "Proceed?",
      options: [],
      checks: [],
      buttons: [_("Ok"), _("Cancel")],
      multiple: "close", // or "queue", or "focus"
      width:  500,
      height: 400,
      alwaysOnTop: true,
    },
    async prompt(features) {
      features = Object.assign({}, this.DEFAULTS, features || {});
      return new Promise((resolve, reject) => {
        ++id;
        let data = {
          id,
          features,
          result: {
            button: -1,
            checks: [],
            option: null,
          },
          done() {
            promptDataMap.delete(this.id);
            this.done = () => {};
            winMan.close();
            resolve(this.result);
            if (promptData === this) {
              promptData = null;
              if (backlog.length) {
                winMan.open(backlog.shift());
              }
            }
          }
        };
        promptDataMap.set(id, data);
        if (promptData && winMan.validateCurrent()) {
          backlog.push(data);
          switch(promptData.features.multiple) {
            case "focus":
              winMan.focus();
            case "queue":
            break;
            default:
              promptData.done();
          }
        } else {
          winMan.open(data);
        }
      });
    },

    get promptData() {
      return promptData;
    }
  }

  return Prompts;

})();
