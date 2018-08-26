ns.on("capabilities", event => {
  if (ns.allows("script")) {
    let name = ns.getWindowName();
    if (/[<"'\`(=:]/.test(name)) {
      console.log(`NoScript XSS filter sanitizing suspicious window.name "%s" on %s`, name, document.URL);
      window.name = window.name.substring(0, window.name.length - name.length);
    }
  }
});
