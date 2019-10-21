
{
  let PREFIX = `[${browser.runtime.getManifest().name}]`;
  let debugCount = 0;

  function log(msg, ...rest) {
    console.log(`${PREFIX} ${msg}`, ...rest);
  }

  function debug(msg, ...rest) {
    console.debug(`${PREFIX}:${debugCount++} ${msg}`, ...rest);
  }

  function error(e, msg, ...rest) {
    console.error(`${PREFIX} ${msg}`, ...rest, e, e.message, e.stack);
  }
}
