if ("windows" in browser) document.addEventListener("DOMContentLoaded", async e => {
  // Fix for Fx57 bug where bundled page loaded using
  // browser.windows.create won't show contents unless resized.
  // See https://bugzilla.mozilla.org/show_bug.cgi?id=1402110
  let win = await browser.windows.getCurrent({populate: true});
  if (win.tabs[0].url === document.URL) {
    debug("Resize hack");
    await browser.windows.update(win.id, {
      width: win.width + 1
    });
    await browser.windows.update(win.id, {
      width: win.width
    });
  }
});
