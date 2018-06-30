class SyntaxChecker {
  constructor() {
    this.lastError = null;
    this.lastFunction = null;
    this.lastScript = "";
  }
  check(script) {
    this.lastScript = script;
    try {
      return !!(this.lastFunction = new Function(script));
    } catch(e) {
       this.lastError = e;
       this.lastFunction = null;
     }
     return false;
  }
  unquote(s, q) {
    // check that this is really a double or a single quoted string...
    if (s.length > 1 && s.startsWith(q) && s.endsWith(q) &&
      // if nothing is left if you remove all he escapes and all the stuff between quotes
      s.replace(/\\./g, '').replace(/^(['"])[^\n\r]*?\1/, '') === '') {
      try {
        return eval(s);
      } catch (e) {
      }
    }
    return null;
  }
}
