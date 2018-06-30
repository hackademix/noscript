var Prompts = (() => {


  var promptData;
  var backlog = [];
  class WindowManager {
    async open(data) {
      promptData = data;
      this.close();
      this.currentWindow = await browser.windows.create({
        url: browser.extension.getURL("ui/prompt.html"),
        type: "panel",
        allowScriptsToClose: true,
      //  titlePreface: "NoScript ",
        width: data.features.width,
        height: data.features.height,
      });
    }
    async close() {
      if (this.currentWindow) {
        try {
          await browser.windows.remove(this.currentWindow.id);
        } catch (e) {
          debug(e);
        }
        this.currentWindow = null;
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
  var Prompts = {
    DEFAULTS: {
      title: "",
      message: "Proceed?",
      options: [],
      checks: [],
      buttons: [_("Ok"), _("Cancel")],
      multiple: "close", // or "queue", or "focus"
      width: 400,
      height: 300,
    },
    async prompt(features) {
      features = Object.assign({}, this.DEFAULTS, features || {});
      return new Promise((resolve, reject) => {
        let data = {
          features,
          result: {
            button: -1,
            checks: [],
            option: null,
          },
          done() {
            this.done = () => {};
            winMan.close();
            resolve(this.result);
            if (backlog.length) {
              winMan.open(backlog.shift());
            } else {
              promptData = null;
            }
          }
        };
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
