(async () => {
  await include("/test/Test.js");
  Test.include([
    "Policy",
    "Storage",
    "XSS",
    "embargoed/XSS",
  ]);
})();
