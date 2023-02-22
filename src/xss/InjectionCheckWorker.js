/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

let include = src => {
  if (Array.isArray(src)) importScripts(...src);
  else importScripts(src);
}

let XSS = {};
include("/nscl/common/log.js");

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
      let {destUrl, request, debugging} = xssReq;
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
