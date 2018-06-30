if (typeof flextabs === "function") {

  for (let tabs of document.querySelectorAll(".flextabs")) {
    flextabs(tabs).init();
    let {id} = tabs;
    if (!id) continue;
    let rx = new RegExp(`(?:^|[#;])tab-${id}=(\\d+)(?:;|$)`);
    let current = location.hash.match(rx);
    console.log(`persisted %o`, current);
    let toggles = tabs.querySelectorAll(".flextabs__toggle");
    let currentToggle = toggles[current && parseInt(current[1]) || 0];
    if (currentToggle) currentToggle.click();
    for (let toggle of toggles) {
      toggle.addEventListener("click", e => {
        let currentIdx = Array.indexOf(toggles, toggle);
        location.hash = location.hash.split(";").filter(p => !rx.test(p))
          .concat(`tab-${id}=${currentIdx}`).join(";");
      });
    }
  }
}
