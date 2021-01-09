var PlaceHolder = (() => {
  const HANDLERS = new Map();
  const CLASS_NAME = "__NoScript_PlaceHolder__";
  const SELECTOR = `a.${CLASS_NAME}`;
  let checkStyle = async () => {
    checkStyle = () => {};
    if (!ns.embeddingDocument) return;
    let replacement = document.querySelector(SELECTOR);
    if (!replacement) return;
    if (window.getComputedStyle(replacement, null).opacity !== "0.8") {
      document.head.appendChild(createHTMLElement("style")).textContent = await
        (await fetch(browser.extension.getURL("/content/content.css"))).text();
    }
  }

  class Handler {
    constructor(type, selector) {
      this.type = type;
      this.selector = selector;
      this.placeHolders = new Map();
      HANDLERS.set(type, this);
    }
    filter(element, request) {
      if (request.embeddingDocument) {
        return document.URL === request.url;
      }
      let url = request.initialUrl || request.url;
      return "data" in element ? element.data === url : element.src === url;
    }
    selectFor(request) {
      return [...document.querySelectorAll(this.selector)]
        .filter(element => this.filter(element, request))
    }
  }

  new Handler("frame", "iframe");
  new Handler("object", "object, embed");
  new Handler("media", "video, audio, source");

  function cloneStyle(src, dest,
    props = ["width", "height", "position", "*", "margin*"]) {
    var suffixes = ["Top", "Right", "Bottom", "Left"];
    for (let i = props.length; i-- > 0;) {
      let p = props[i];
      if (p.endsWith("*")) {
        let prefix = p.substring(0, p.length - 1);
        props.splice(i, 1, ...
          (suffixes.map(prefix ? (suffix => prefix + suffix) :
            suffix => suffix.toLowerCase())));
      }
    };

    let srcStyle = window.getComputedStyle(src, null);
    let destStyle = dest.style;
    for (let p of props) {
      destStyle[p] = srcStyle[p];
    }
    for (let size of ["width", "height"]) {
      if (/^0(?:\D|$)/.test(destStyle[size])) {
        destStyle[size] = "";
      }
    }
    if (src.offsetTop < 0 && src.offsetTop <= (-src.offsetHeight)) {
      destStyle.top = "0"; // fixes video player off-display position on Youtube
    }
    destStyle.display = srcStyle.display !== "block" ? "inline-block" : "block";
  }

  class PlaceHolder {

    static create(policyType, request) {
      return new PlaceHolder(policyType, request);
    }
    static canReplace(policyType) {
      return HANDLERS.has(policyType);
    }
    static handlerFor(policyType) {
      return HANDLERS.get(policyType);
    }

    static listen() {
      PlaceHolder.listen = () => {};
      window.addEventListener("click", ev => {
        if (ev.button === 0 && ev.isTrusted) {
          let ph, replacement;
          for (let e of document.elementsFromPoint(ev.clientX, ev.clientY)) {
            if (ph = e._placeHolderObj) {
              replacement = e;
              break;
            }
            if (replacement = e._placeHolderReplacement) {
              ph = replacement._placeHolderObj;
              break;
            }
          }
          if (ph) {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.target.value === "close") {
              ph.close(replacement);
            } else {
              ph.enable(replacement);
            }
          }
        }
      }, true, false);
    }

    constructor(policyType, request) {
      this.policyType = policyType;
      this.request = request;
      this.replacements = new Set();
      this.handler = PlaceHolder.handlerFor(policyType);
      if (this.handler) {
        [...document.querySelectorAll(this.handler.selector)]
        .filter(element => this.handler.filter(element, request))
          .forEach(element => this.replace(element));
      };
      if (this.replacements.size) {
        PlaceHolder.listen();
        checkStyle();
      }
    }

    replace(element) {
      if (!element.parentElement) return;
      if (element.parentElement instanceof HTMLMediaElement) {
        this.replace(element.parentElement);
        return;
      }
      let {
        url
      } = this.request;
      let objUrl = new URL(url)
      this.origin = objUrl.origin;
      if (this.origin === "null") {
        this.origin = objUrl.protocol;
      }
      let TYPE = `<${this.policyType.toUpperCase()}>`;

      let replacement = createHTMLElement("a");
      replacement.className = CLASS_NAME;
      cloneStyle(element, replacement);
      if (ns.embeddingDocument) {
        replacement.classList.add("__ns__document");
        window.stop();
      }

      replacement.href = url;
      replacement.title = `${TYPE}@${url}`;

      let inner = replacement.appendChild(createHTMLElement("span"));
      inner.className = replacement.className;

      let button = inner.appendChild(createHTMLElement("button"));
      button.className = replacement.className;
      button.setAttribute("aria-label", button.title = _("Close"));
      button.value = "close";
      button.textContent = "×";

      let description = inner.appendChild(createHTMLElement("span"));
      description.textContent = `${TYPE}@${this.origin}`;

      replacement._placeHolderObj = this;
      replacement._placeHolderElement = element;
      for (let e of replacement.querySelectorAll("*")) {
        e._placeHolderReplacement = replacement;
      }

      element.replaceWith(replacement);

      // do our best to bring it to front
      for (let p = replacement; p = p.parentElement;) {
        p.classList.add("__ns__pop2top");
      };

      this.replacements.add(replacement);
    }

    async enable(replacement) {
      debug("Enabling %o", this.request, this.policyType);
      let ret = await Messages.send("blockedObjects", {
        url: this.request.url,
        policyType: this.policyType,
        documentUrl: document.URL
      });
      debug("Received response", ret);
      if (!ret) return;
      // bring back ancestors
      for (let p = replacement; p = p.parentElement;) {
        p.classList.remove("__ns__pop2top");
      };
      if (ret.collapse) {
        for (let collapsing of (ret.collapse === "all" ? document.querySelectorAll(SELECTOR) : [replacement])) {
          this.replacements.delete(collapsing);
          collapsing.remove();
        }
        return;
      }
      if (this.request.embeddingDocument) {
        window.location.reload();
        return;
      }
      try {
        let element = replacement._placeHolderElement;
        replacement.replaceWith(element.cloneNode(true));
        this.replacements.delete(replacement);
      } catch (e) {
        error(e, "While replacing");
      }
    }

    close(replacement) {
      replacement.classList.add("__ns__closing");
      this.replacements.delete(replacement);
      window.setTimeout(() => {
        for (let p = replacement; p = p.parentElement;) {
          p.classList.remove("__ns__pop2top");
        };
        replacement.remove()
      }, 500);
    }
  }
  return PlaceHolder;
})();
