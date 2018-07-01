
{
  let PREFIX = `[${browser.runtime.getManifest().name}]`;

  function log(msg, ...rest) {
    console.log(`${PREFIX} ${msg}`, ...rest);
  }
  function debug(msg, ...rest) {
    console.debug(`${PREFIX} ${msg}`, ...rest);
  }
  function error(e, msg, ...rest) {
    console.error(`${PREFIX} ${msg}`, ...rest, e, e.message, e.stack);
  }
}
