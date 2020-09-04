'use strict'
var DocumentFreezer = (() => {

  const loaderAttributes = ["href", "src", "data"];
  const jsOrDataUrlRx = /^(?:data:(?:[^,;]*ml|unknown-content-type)|javascript:)/i;

  // List updated by build.sh from https://hg.mozilla.org/mozilla-central/raw-file/tip/xpcom/ds/StaticAtoms.py
      // whenever html5_events/html5_events.pl retrieves something new.
  const eventTypes = ['abort', 'mozaccesskeynotfound', 'activate', 'afterprint', 'afterscriptexecute', 'animationcancel', 'animationend', 'animationiteration', 'animationstart', 'audioprocess', 'auxclick', 'beforecopy', 'beforecut', 'beforeinput', 'beforepaste', 'beforeprint', 'beforescriptexecute', 'beforeunload', 'blocked', 'blur', 'bounce', 'boundschange', 'broadcast', 'bufferedamountlow', 'cached', 'cancel', 'change', 'chargingchange', 'chargingtimechange', 'checking', 'click', 'close', 'command', 'commandupdate', 'complete', 'compositionend', 'compositionstart', 'compositionupdate', 'connect', 'connectionavailable', 'contextmenu', 'copy', 'cut', 'dblclick', 'dischargingtimechange', 'downloading', 'data', 'drag', 'dragdrop', 'dragend', 'dragenter', 'dragexit', 'dragleave', 'dragover', 'dragstart', 'drain', 'drop', 'error', 'finish', 'focus', 'focusin', 'focusout', 'fullscreenchange', 'fullscreenerror', 'get', 'hashchange', 'input', 'inputsourceschange', 'install', 'invalid', 'keydown', 'keypress', 'keyup', 'languagechange', 'levelchange', 'load', 'loading', 'loadingdone', 'loadingerror', 'popstate', 'merchantvalidation', 'message', 'messageerror', 'midimessage', 'mousedown', 'mouseenter', 'mouseleave', 'mouselongtap', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'mozfullscreenchange', 'mozfullscreenerror', 'mozkeydownonplugin', 'mozkeyuponplugin', 'mozpointerlockchange', 'mozpointerlockerror', 'mute', 'notificationclick', 'notificationclose', 'noupdate', 'obsolete', 'online', 'offline', 'open', 'orientationchange', 'overflow', 'pagehide', 'pageshow', 'paste', 'payerdetailchange', 'paymentmethodchange', 'pointerlockchange', 'pointerlockerror', 'popuphidden', 'popuphiding', 'popuppositioned', 'popupshowing', 'popupshown', 'processorerror', 'push', 'pushsubscriptionchange', 'readystatechange', 'rejectionhandled', 'remove', 'requestprogress', 'resourcetimingbufferfull', 'responseprogress', 'reset', 'resize', 'scroll', 'select', 'selectionchange', 'selectend', 'selectstart', 'set', 'shippingaddresschange', 'shippingoptionchange', 'show', 'squeeze', 'squeezeend', 'squeezestart', 'statechange', 'storage', 'submit', 'success', 'typechange', 'terminate', 'text', 'toggle', 'tonechange', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'transitioncancel', 'transitionend', 'transitionrun', 'transitionstart', 'underflow', 'unhandledrejection', 'unload', 'unmute', 'updatefound', 'updateready', 'upgradeneeded', 'versionchange', 'visibilitychange', 'voiceschanged', 'vrdisplayactivate', 'vrdisplayconnect', 'vrdisplaydeactivate', 'vrdisplaydisconnect', 'vrdisplaypresentchange', 'webkitanimationend', 'webkitanimationiteration', 'webkitanimationstart', 'webkittransitionend', 'wheel', 'zoom', 'begin', 'end', 'repeat', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'gotpointercapture', 'lostpointercapture', 'devicemotion', 'deviceorientation', 'absolutedeviceorientation', 'deviceproximity', 'mozorientationchange', 'userproximity', 'devicelight', 'devicechange', 'mozvisualresize', 'mozvisualscroll', 'mozshowdropdown', 'scrollend', 'loadend', 'loadstart', 'progress', 'suspend', 'emptied', 'stalled', 'play', 'pause', 'loadedmetadata', 'loadeddata', 'waiting', 'playing', 'canplay', 'canplaythrough', 'seeking', 'seeked', 'timeout', 'timeupdate', 'ended', 'formdata', 'ratechange', 'durationchange', 'volumechange', 'addtrack', 'controllerchange', 'cuechange', 'enter', 'exit', 'encrypted', 'waitingforkey', 'keystatuseschange', 'removetrack', 'dataavailable', 'warning', 'start', 'stop', 'photo', 'gamepadbuttondown', 'gamepadbuttonup', 'gamepadaxismove', 'gamepadconnected', 'gamepaddisconnected', 'fetch', 'audiostart', 'audioend', 'soundstart', 'soundend', 'speechstart', 'speechend', 'result', 'nomatch', 'resume', 'mark', 'boundary', 'activated', 'deactivated', 'metadatachange', 'playbackstatechange', 'positionstatechange', 'supportedkeyschange', 'sourceopen', 'sourceended', 'sourceclosed', 'updatestart', 'update', 'updateend', 'addsourcebuffer', 'removesourcebuffer', 'appinstalled', 'activestatechanged', 'adapteradded', 'adapterremoved', 'alerting', 'antennaavailablechange', 'attributechanged', 'attributereadreq', 'attributewritereq', 'beforeevicted', 'busy', 'callschanged', 'cardstatechange', 'cfstatechange', 'characteristicchanged', 'clirmodechange', 'connected', 'connecting', 'connectionstatechanged', 'currentchannelchanged', 'currentsourcechanged', 'datachange', 'dataerror', 'deleted', 'deliveryerror', 'deliverysuccess', 'devicefound', 'devicepaired', 'deviceunpaired', 'dialing', 'disabled', 'disconnect', 'disconnected', 'disconnecting', 'displaypasskeyreq', 'draggesture', 'eitbroadcasted', 'emergencycbmodechange', 'enabled', 'enterpincodereq', 'evicted', 'failed', 'frequencychange', 'groupchange', 'headphoneschange', 'held', 'hfpstatuschanged', 'hidstatuschanged', 'holding', 'iccchange', 'iccdetected', 'iccinfochange', 'iccundetected', 'incoming', 'mapfolderlistingreq', 'mapgetmessagereq', 'mapmessageslistingreq', 'mapmessageupdatereq', 'mapsendmessagereq', 'mapsetmessagestatusreq', 'mousewheel', 'mozbrowserafterkeydown', 'mozbrowserafterkeyup', 'mozbrowserbeforekeydown', 'mozbrowserbeforekeyup', 'mozinterruptbegin', 'mozinterruptend', 'moznetworkdownload', 'moznetworkupload', 'moztimechange', 'newrdsgroup', 'obexpasswordreq', 'otastatuschange', 'overflowchanged', 'paint', 'pairingaborted', 'pairingconfirmationreq', 'pairingconsentreq', 'pendingchange', 'pichange', 'pschange', 'ptychange', 'pullphonebookreq', 'pullvcardentryreq', 'pullvcardlistingreq', 'radiostatechange', 'rdsdisabled', 'rdsenabled', 'readerror', 'readsuccess', 'ready', 'received', 'reloadpage', 'remoteheld', 'remoteresumed', 'requestmediaplaystatus', 'resuming', 'retrieving', 'rtchange', 'scanningstatechanged', 'scostatuschanged', 'sending', 'sent', 'speakerforcedchange', 'statuschanged', 'stkcommand', 'stksessionend', 'storageareachanged', 'ussdreceived', 'voicechange', 'websocket'];

  function suppressEvents(e) {
    e.stopPropagation();
    console.debug(`Suppressing ${e.type} on `, e.target); // DEV_ONLY
  }

  function freezeAttributes() {
    for (let element of document.querySelectorAll("*")) {
      if (element._frozen) continue;
      let fa = [];
      let loaders = [];
      for (let a of element.attributes) {
        let name = a.localName.toLowerCase();
        if (loaderAttributes.includes(name)) {
          if (jsOrDataUrlRx.test(a.value)) {
            loaders.push(a);
          }
        } else if (name.startsWith("on")) {
          console.debug("Removing", a, element.outerHTML);
          fa.push(a.cloneNode());
          a.value = "";
          element[name] = null;
        }
      }
      if (loaders.length) {
        for (let a of loaders) {
          fa.push(a.cloneNode());
          a.value = "javascript://frozen";
        }
        if ("contentWindow" in element) {
          element.replaceWith(element = element.cloneNode(true));
        }
      }
      if (fa.length) element._frozenAttributes = fa;
      element._frozen = true;
    }
  }

  function unfreezeAttributes() {
    for (let element of document.querySelectorAll("*")) {
      if (!element._frozenAttributes) continue;
      for (let a of element._frozenAttributes) {
        element.setAttributeNS(a.namespaceURI, a.name, a.value);
      }
      if ("contentWindow" in element) {
        element.replaceWith(element.cloneNode(true));
      }
    }
  }

  let domFreezer = new MutationObserver(records => {
    console.debug("domFreezer on", document.documentElement.outerHTML);
    freezeAttributes();
  });

  let suppressedScripts = 0;
  let scriptSuppressor = e => {
    if (!e.isTrusted) return;
    e.preventDefault();
    ++suppressedScripts;
    console.debug(`Suppressed script #${suppressedScripts}`, e.target);
  };

  return {
    freeze() {
      if (document._frozen) return false;
      console.debug("Freezing", document.URL);
      document._frozen = true;
      for (let et of eventTypes) document.addEventListener(et, suppressEvents, true);
      try {
        freezeAttributes();
      } catch(e) {
        console.error(e);
      }
      domFreezer.observe(document, {childList: true, subtree: true});
      suppressedScripts = 0;
      addEventListener("beforescriptexecute", scriptSuppressor, true);
      return true;
    },
    unfreeze() {
      if (!document._frozen) return false;
      console.debug("Unfreezing", document.URL);
      domFreezer.disconnect();
      try {
        unfreezeAttributes();
      } catch(e) {
        console.error(e);
      }
      removeEventListener("beforescriptexecute", scriptSuppressor, true);
      for (let et of eventTypes) document.removeEventListener(et, suppressEvents, true);
      document._frozen = false;
      return true;
    },
    get suppressedScripts() { return suppressedScripts; },
  };
})()