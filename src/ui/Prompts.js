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
    async open(data) {
      promptData = data;
      this.close();
      let {width, height} = data.features;
      let options = {
        url: browser.runtime.getURL("ui/prompt.html"),
        type: "panel",
        width,
        height,
      };
      if (UA.isMozilla) {
        options.allowScriptsToClose = true;
      }
      if (!("windows" in browser)) {
        // Android, most likely
        this.currentTab = await browser.tabs.create({url: options.url});
        return;
      }
      this.currentWindow = await browser.windows.create(options);
      // work around for https://bugzilla.mozilla.org/show_bug.cgi?id=1330882
      let {left, top, width: cw, height: ch} = this.currentWindow;
      if (width && height && cw !== width || ch !== height) {
        left += Math.round((cw - width) / 2);
        top += Math.round((ch - height) / 2);
        for (let attempts = 2; attempts-- > 0;) // top gets set only 2nd time, moz bug?
          await browser.windows.update(this.currentWindow.id,
              {left, top, width, height});
      }
    }
    async close() {
      if (this.currentWindow) {
        try {
          await browser.windows.remove(this.currentWindow.id);
        } catch (e) {
          debug(e);
        }
        this.currentWindow = null;
      } else if (this.currentTab) {
        await browser.tabs.remove(this.currentTab.id);
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
        if (promptData) {
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
