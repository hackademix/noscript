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

  if (UA.isMozilla && document.readyState !== "complete") {
    // Mozilla has already parsed the <head> element, we must take extra steps...

    let softReloading = true;
    debug("Early parsing: preemptively suppressing events and script execution.");

    {

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
        let {readyState} = document;
        debug("Readystate: %s, canScript: ", readyState, ns.canScript);
        if (ns.canScript) {
          let softReload = e => {
            try {
              debug("Soft reload", e);
              removeEventListener("DOMContentLoaded", softReload, true);
              let document = window.wrappedJSObject.document;
              let html = document.documentElement.outerHTML;
              document.open();
              softReloading = false;
              document.write(html);
              document.close();
            } catch(e) {
              error(e);
            }
          }
          if (readyState === "loading") {
            debug("Deferring softReload to DOMContentLoaded...");
            addEventListener("DOMContentLoaded", softReload, true);
          } else {
            softReload();
          }
        } else {
          try {
            for (let node of document.querySelectorAll("*")) {
              let evAttrs = [...node.attributes].filter(a => a.name.toLowerCase().startsWith("on"));
              for (let a of evAttrs) {
                debug("Reparsing event attribute after CSP", a, node);
                node.removeAttributeNode(a);
                node.setAttributeNodeNS(a);
              }
            }
            softReloading = false;
          } catch (e) {
            error(e);
          }
        }
      });
    }

    addEventListener("beforescriptexecute", e => {
      if (!e.isTrusted) return;
      debug(e.type, e.target);
      if (softReloading) {
        e.preventDefault();
        debug("Blocked early script", s);
      }
    }, true);
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