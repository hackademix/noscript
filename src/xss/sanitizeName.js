if (/[<"'\`(=:]/.test(window.name)) {
  console.log(`NoScript XSS filter sanitizing suspicious window.name "%s" on %s`, window.name, document.URL);
  window.name = "";
}
