{
  let toolbar = document.getElementById("top");
  let spacer = toolbar.querySelector(".spacer");
  let hider = toolbar.querySelector(".hider");

  if (UI.local.toolbarLayout) {
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
      this.draggedElement = d;
    },
    dragend(ev)  {
      ev.target.style.opacity = "";
    },
    dragover(ev) {
      ev.preventDefault();
    },
    dragenter(ev) {
    },
    dragleave(ev) {
    },
    drop(ev) {
      let t = ev.target;
      let d = ev.dataTransfer ?
        document.getElementById(ev.dataTransfer.getData("text/plain"))
        : this.draggedElement;
      this.draggedElement = null;
      if (!d) return;
      switch(t) {
        case hider:
          t.appendChild(d);
          break;
        default:
          if (!t.closest("#top")) return; // outside the toolbar?
          let stop = null;
          for (let c of toolbar.children) {
            if (ev.clientX < c.offsetLeft + c.offsetWidth / 2) {
              stop = c;
              break;
            }
          }
          t.insertBefore(d, stop);
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
        hidden: Array.from(document.querySelectorAll("#top > .hider > .icon")).map(el => el.id),
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

let dragDiv = document.createElement("div");
  for (let draggable of document.querySelectorAll("#top .icon")) {
    draggable.setAttribute("draggable", "true");
    // work-around for https://bugzilla.mozilla.org/show_bug.cgi?id=568313
    draggable.appendChild(dragDiv.cloneNode());
  }
}
