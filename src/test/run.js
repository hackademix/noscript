(async () => {
  await include("/test/Test.js");
  Test.include([
    "Policy",
    "XSS",
    "embargoed/XSS",
  ]);
})();
