"use strict";

(this.ns || (this.ns = {})).syncFetchPolicy = function() {

  let url = document.URL;

  // Here we've got no CSP header yet (file: or ftp: URL), we need one
  // injected in the DOM as soon as possible.
  debug("No CSP yet for non-HTTP document load: fetching policy synchronously...");

  let syncFetch = callback => {
    browser.runtime.sendSyncMessage(
      {id: "fetchPolicy", url, contextUrl: url},
      callback);
  };
  debug("Initial readyState and body", document.readyState, document.body);

  if (UA.isMozilla) {
    // Mozilla has already parsed the <head> element, we must take extra steps...

    let softReloading = true;
    let suppressedScripts = 0;
    debug("Early parsing: preemptively suppressing events and script execution.");

    try {

      if (document.body && document.body.onload) {
          // special treatment for body[onload], which could not be suppressed otherwise
          document.body._onload = document.body.getAttribute("onload");
          document.body.removeAttribute("onload");
          document.body.onload = null;
      }

      // List updated by build.sh from https://hg.mozilla.org/mozilla-central/raw-file/tip/xpcom/ds/StaticAtoms.py
      // whenever html5_events/html5_events.pl retrieves something new.
      let eventTypes = ['abort', 'mozaccesskeynotfound', 'activate', 'afterprint', 'afterscriptexecute', 'animationcancel', 'animationend', 'animationiteration', 'animationstart', 'audioprocess', 'auxclick', 'beforecopy', 'beforecut', 'beforeinput', 'beforepaste', 'beforeprint', 'beforescriptexecute', 'beforeunload', 'blocked', 'blur', 'bounce', 'boundschange', 'broadcast', 'bufferedamountlow', 'cached', 'cancel', 'change', 'chargingchange', 'chargingtimechange', 'checking', 'click', 'close', 'command', 'commandupdate', 'complete', 'compositionend', 'compositionstart', 'compositionupdate', 'connect', 'connectionavailable', 'contextmenu', 'copy', 'cut', 'dblclick', 'dischargingtimechange', 'downloading', 'data', 'drag', 'dragdrop', 'dragend', 'dragenter', 'dragexit', 'dragleave', 'dragover', 'dragstart', 'drain', 'drop', 'error', 'finish', 'focus', 'focusin', 'focusout', 'fullscreenchange', 'fullscreenerror', 'get', 'hashchange', 'input', 'inputsourceschange', 'install', 'invalid', 'keydown', 'keypress', 'keyup', 'languagechange', 'levelchange', 'load', 'loading', 'loadingdone', 'loadingerror', 'popstate', 'merchantvalidation', 'message', 'messageerror', 'midimessage', 'mousedown', 'mouseenter', 'mouseleave', 'mouselongtap', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'mozfullscreenchange', 'mozfullscreenerror', 'mozkeydownonplugin', 'mozkeyuponplugin', 'mozpointerlockchange', 'mozpointerlockerror', 'mute', 'notificationclick', 'notificationclose', 'noupdate', 'obsolete', 'online', 'offline', 'open', 'orientationchange', 'overflow', 'pagehide', 'pageshow', 'paste', 'payerdetailchange', 'paymentmethodchange', 'pointerlockchange', 'pointerlockerror', 'popuphidden', 'popuphiding', 'popuppositioned', 'popupshowing', 'popupshown', 'processorerror', 'push', 'pushsubscriptionchange', 'readystatechange', 'rejectionhandled', 'remove', 'requestprogress', 'resourcetimingbufferfull', 'responseprogress', 'reset', 'resize', 'scroll', 'select', 'selectionchange', 'selectend', 'selectstart', 'set', 'shippingaddresschange', 'shippingoptionchange', 'show', 'squeeze', 'squeezeend', 'squeezestart', 'statechange', 'storage', 'submit', 'success', 'typechange', 'terminate', 'text', 'toggle', 'tonechange', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'transitioncancel', 'transitionend', 'transitionrun', 'transitionstart', 'underflow', 'unhandledrejection', 'unload', 'unmute', 'updatefound', 'updateready', 'upgradeneeded', 'versionchange', 'visibilitychange', 'voiceschanged', 'vrdisplayactivate', 'vrdisplayconnect', 'vrdisplaydeactivate', 'vrdisplaydisconnect', 'vrdisplaypresentchange', 'webkitanimationend', 'webkitanimationiteration', 'webkitanimationstart', 'webkittransitionend', 'wheel', 'zoom', 'begin', 'end', 'repeat', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'gotpointercapture', 'lostpointercapture', 'devicemotion', 'deviceorientation', 'absolutedeviceorientation', 'deviceproximity', 'mozorientationchange', 'userproximity', 'devicelight', 'devicechange', 'mozvisualresize', 'mozvisualscroll', 'mozshowdropdown', 'scrollend', 'loadend', 'loadstart', 'progress', 'suspend', 'emptied', 'stalled', 'play', 'pause', 'loadedmetadata', 'loadeddata', 'waiting', 'playing', 'canplay', 'canplaythrough', 'seeking', 'seeked', 'timeout', 'timeupdate', 'ended', 'formdata', 'ratechange', 'durationchange', 'volumechange', 'addtrack', 'controllerchange', 'cuechange', 'enter', 'exit', 'encrypted', 'waitingforkey', 'keystatuseschange', 'removetrack', 'dataavailable', 'warning', 'start', 'stop', 'photo', 'gamepadbuttondown', 'gamepadbuttonup', 'gamepadaxismove', 'gamepadconnected', 'gamepaddisconnected', 'fetch', 'audiostart', 'audioend', 'soundstart', 'soundend', 'speechstart', 'speechend', 'result', 'nomatch', 'resume', 'mark', 'boundary', 'activated', 'deactivated', 'metadatachange', 'playbackstatechange', 'positionstatechange', 'supportedkeyschange', 'sourceopen', 'sourceended', 'sourceclosed', 'updatestart', 'update', 'updateend', 'addsourcebuffer', 'removesourcebuffer', 'appinstalled', 'activestatechanged', 'adapteradded', 'adapterremoved', 'alerting', 'antennaavailablechange', 'attributechanged', 'attributereadreq', 'attributewritereq', 'beforeevicted', 'busy', 'callschanged', 'cardstatechange', 'cfstatechange', 'characteristicchanged', 'clirmodechange', 'connected', 'connecting', 'connectionstatechanged', 'currentchannelchanged', 'currentsourcechanged', 'datachange', 'dataerror', 'deleted', 'deliveryerror', 'deliverysuccess', 'devicefound', 'devicepaired', 'deviceunpaired', 'dialing', 'disabled', 'disconnect', 'disconnected', 'disconnecting', 'displaypasskeyreq', 'draggesture', 'eitbroadcasted', 'emergencycbmodechange', 'enabled', 'enterpincodereq', 'evicted', 'failed', 'frequencychange', 'groupchange', 'headphoneschange', 'held', 'hfpstatuschanged', 'hidstatuschanged', 'holding', 'iccchange', 'iccdetected', 'iccinfochange', 'iccundetected', 'incoming', 'mapfolderlistingreq', 'mapgetmessagereq', 'mapmessageslistingreq', 'mapmessageupdatereq', 'mapsendmessagereq', 'mapsetmessagestatusreq', 'mousewheel', 'mozbrowserafterkeydown', 'mozbrowserafterkeyup', 'mozbrowserbeforekeydown', 'mozbrowserbeforekeyup', 'mozinterruptbegin', 'mozinterruptend', 'moznetworkdownload', 'moznetworkupload', 'moztimechange', 'newrdsgroup', 'obexpasswordreq', 'otastatuschange', 'overflowchanged', 'paint', 'pairingaborted', 'pairingconfirmationreq', 'pairingconsentreq', 'pendingchange', 'pichange', 'pschange', 'ptychange', 'pullphonebookreq', 'pullvcardentryreq', 'pullvcardlistingreq', 'radiostatechange', 'rdsdisabled', 'rdsenabled', 'readerror', 'readsuccess', 'ready', 'received', 'reloadpage', 'remoteheld', 'remoteresumed', 'requestmediaplaystatus', 'resuming', 'retrieving', 'rtchange', 'scanningstatechanged', 'scostatuschanged', 'sending', 'sent', 'speakerforcedchange', 'statuschanged', 'stkcommand', 'stksessionend', 'storageareachanged', 'ussdreceived', 'voicechange', 'websocket'];
      let eventSuppressor = e => {
        try {
          debug("Event suppressor called for ", e.type, e.target); // DEV_ONLY

          if (softReloading) {
            e.stopPropagation();
            debug(`Suppressing ${e.type} on `, e.target); // DEV_ONLY
          } else {
            debug("Stopping event suppression");
            for (let et of eventTypes) document.removeEventListener(et, eventSuppressor, true);
          }
        } catch (e) {
          error(e);
        }
      }
      debug("Starting event suppression");
      for (let et of eventTypes) document.addEventListener(et, eventSuppressor, true);

      ns.on("capabilities", () => {
        if (document.body && document.body._onload) {
          document.body.setAttribute("onload", document.body._onload);
        }

        let {readyState} = document;
        debug("Readystate: %s, %suppressedScripts %s, canScript = %s", readyState, suppressedScripts, ns.canScript);
        if (!ns.canScript) {
           for (let node of document.querySelectorAll("*")) {
            let evAttrs = [...node.attributes].filter(a => a.name.toLowerCase().startsWith("on"));
            for (let a of evAttrs) {
              debug("Reparsing event attribute", a, node);
              node.removeAttributeNode(a);
              node.setAttributeNodeNS(a);
            }
          }
          softReloading = false;
          return;
        }

        if (suppressedScripts === 0 && readyState === "loading") {
          // we don't care reloading, if no script has been suppressed
          // and no readyState change has been fired yet
          softReloading = false;
          return;
        }

        let softReload = ev => {
           let html = document.documentElement.outerHTML;
           try {
            debug("Soft reload", ev, html);
            softReloading = false;
            try {
              let doc = window.wrappedJSObject.document;
              removeEventListener("DOMContentLoaded", softReload, true);
              doc.open();
              doc.write(html);
              doc.close();
              debug("Written", html)
            } catch (e) {
              debug("Can't use document.write(), XML document?");
              try {
                Promise.all([...document.querySelectorAll("script")].map(s => {
                  let clone = document.createElement("script");
                  for (let a of s.attributes) {
                    clone.setAttribute(a.name, a.value);
                  }
                  clone.textContent = s.textContent;
                  let doneEvents = ["afterscriptexecute", "load", "error"];
                  return new Promise(resolve => {
                    let listener = ev => {
                      if (ev.target !== clone) return;
                      debug("Resolving on ", ev.type, ev.target);
                      resolve(ev.target);
                      for (let et of doneEvents) removeEventListener(et, listener, true);
                    };
                    for (let et of doneEvents) {
                      addEventListener(et, listener, true);
                     }
                    s.replaceWith(clone);
                    debug("Replaced", clone);
                  });
                })).then(r => {
                    debug("All scripts done", r);
                    document.dispatchEvent(new Event("readystatechange"));
                    document.dispatchEvent(new Event("DOMContentLoaded", {
                      bubbles: true,
                      cancelable: true
                    }));
                    if (document.readyState === "complete") {
                      window.dispatchEvent(new Event("load"));
                    }
                  });
              } catch (e) {
                error(e);
              }
            }
          } catch(e) {
            error(e);
          }
        };

        if (readyState === "loading") {
          debug("Deferring softReload to DOMContentLoaded...");
          addEventListener("DOMContentLoaded", softReload, true);
        } else {
          softReload();
        }

      });
    } catch (e) {
      error(e);
    }

    let scriptSuppressor = e => {
      if (!e.isTrusted) return;
      debug(e.type, e.target, softReloading); // DEV_ONLY
      if (softReloading) {
        e.preventDefault();
        ++suppressedScripts;
        debug(`Suppressed early script #${suppressedScripts}`, e.target);
      } else {
        removeEventListener(e.type, scriptSuppressor);
      }
    };
    addEventListener("beforescriptexecute", scriptSuppressor, true);
  }

  let setup = policy => {
    debug("Fetched %o, readyState %s", policy, document.readyState); // DEV_ONLY
    ns.setup(policy);
  }

  for (let attempts = 3; attempts-- > 0;) {
    try {
      syncFetch(setup);
      break;
    } catch (e) {
      if (!Messages.isMissingEndpoint(e) || document.readyState === "complete") {
        error(e);
        break;
      }
      error("Background page not ready yet, retrying to fetch policy...")
    }
  }
}