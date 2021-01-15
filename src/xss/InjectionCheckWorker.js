let include = src => {
  if (Array.isArray(src)) importScripts(...src);
  else importScripts(src);
}

let XSS = {};
include("/lib/log.js");

for (let logType of ["log", "debug", "error"]) {
  this[logType] = (...log) => {
    postMessage({log, logType});
  }
}

include("InjectionChecker.js");

{
  let timingsMap = new Map();

  let Handlers = {
    async check({xssReq, skip}) {
      let {destUrl, unparsedRequest: request, debugging} = xssReq;
      let {
        skipParams,
        skipRx
      } = skip;
      let ic = new (await XSS.InjectionChecker)();

      if (debugging) {
        ic.logEnabled = true;
        debug("[XSS] InjectionCheckWorker started in %s ms (%s).",
          Date.now() - xssReq.timestamp, destUrl);
      } else {
        debug = () => {};
      }

      let {timing} = ic;
      timingsMap.set(request.requestId, timing);
      timing.pauseTime = 0; // skip the default 20ms nap

      let postInjection = xssReq.isPost &&
          request.requestBody && request.requestBody.formData &&
          await ic.checkPost(request.requestBody.formData, skipParams);

      let protectName = ic.nameAssignment;
      let urlInjection = await ic.checkUrl(destUrl, skipRx);
      protectName = protectName || ic.nameAssignment;
      if (timing.tooLong) {
        log("[XSS] Long check (%s ms) - %s", timing.elapsed, JSON.stringify(xssReq));
      } else if (debugging) {
        debug("[XSS] InjectionCheckWorker done in %s ms (%s).",
          Date.now() - xssReq.timestamp, destUrl);
      }

      postMessage(!(protectName || postInjection || urlInjection) ? null
        : { protectName, postInjection, urlInjection }
      );
    },

    requestDone({requestId}) {
      let timing = timingsMap.get(requestId);
      if (timing) {
        timing.interrupted = true;
        timingsMap.delete(requestId);
      }
    }
  }

  onmessage = async e => {
    let msg = e.data;
    if (msg.handler in Handlers) try {
      await Handlers[msg.handler](msg);
    } catch (e) {
      postMessage({error: e.message});
    }
  }

}
