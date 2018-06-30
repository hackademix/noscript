{
  let toolbar = document.getElementById("top");
  let spacer = toolbar.querySelector(".spacer");
  let hider = toolbar.querySelector(".hider");

  if (UI.local.toolbarLayout) {
    debug(uneval(UI.local.toolbarLayout));
    let {left, right, hidden} = UI.local.toolbarLayout;
    for (let id of left) {
      toolbar.insertBefore(document.getElementById(id), hider);
    }
    for (let id of right) {
      toolbar.appendChild(document.getElementById(id));
    }
    for (let id of hidden) {
      hider.appendChild(document.getElementById(id));
    }
  }

  for (let i of toolbar.querySelectorAll(".icon")) {
    if (!i.title) i.title = i.textContent;
  }

  function toggleHider(b) {
    let cl = hider.classList;
    cl.toggle("open", b);
    cl.toggle("empty", !hider.querySelector(".icon"));
  }
  hider.querySelector(".hider-close").onclick = e => {
    toggleHider(false);
  };

  toggleHider(false);

  let dnd = {
   dragstart(ev) {
      let d = ev.target;
      if (hider.querySelectorAll(".icon").length) {
        toggleHider(true);
      }

      if (!d.classList.contains("icon")) {
        ev.preventDefault();
        return;
      }
      d.style.opacity = ".5";
      let dt = ev.dataTransfer;
      dt.setData("text/plain", d.id);
      dt.dropEffect = "move";
      dt.setDragImage(d, 0, 0);
      toggleHider(true);
    },
    dragend(ev)  {
      ev.target.style.opacity = "";
    },
    dragover(ev) {
      ev.preventDefault();
    },
    dragenter(ev) {
      let t = ev.target;
    },
    dragleave(ev) {
      let t = ev.target;
    },
    drop(ev) {
      let t = ev.target;
      let d = document.getElementById(ev.dataTransfer.getData("text/plain"));
      switch(t) {
        case hider:
          t.appendChild(d);
          break;
        case toolbar:
          t.insertBefore(d, ev.clientX < hider.offsetLeft ? hider : spacer.nextElementSibling);
          break;
        default:
          t.parentNode.insertBefore(d, ev.clientX < (t.offsetLeft + t.offsetWidth) ? t : t.nextElementSibling);
      }

      let left = [], right = [];
      let side = left;
      for (let el of document.querySelectorAll("#top > .icon, #top > .spacer")) {
        if (el === spacer) {
          side = right;
        } else {
          side.push(el.id);
        }
      }
      UI.local.toolbarLayout = {
        left, right,
        hidden: Array.map(document.querySelectorAll("#top > .hider > .icon"), el => el.id),
      };

      debug("%o", UI.local);
      UI.updateSettings({local: UI.local});
    },

    click(ev) {
      let el = ev.target;
      if (el.parentNode === hider && el.classList.contains("icon")) {
        ev.preventDefault();
        ev.stopPropagation();
      } else if (el === spacer || el.classList.contains("reveal")) {
        toggleHider(true);
      }
    }

  };


  for (let [action, handler] of Object.entries(dnd)) {
    toolbar.addEventListener(action, handler, true);
  }

  for (let draggable of document.querySelectorAll("#top .icon")) {
    draggable.setAttribute("draggable", "true");
  }
}
