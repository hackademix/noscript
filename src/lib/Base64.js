
'use strict';
// we need this because of https://bugzilla.mozilla.org/show_bug.cgi?id=439276

var Base64 = {

  purify: function(input) {
    return input.replace(/[^A-Za-z0-9\+\/=]+/g, '');
  },

  alt: function(s) {
    // URL base64 variant, see http://en.wikipedia.org/wiki/Base64#URL_applications
    return s.replace(/-/g, '+').replace(/_/g, '/')
  },

  decode: function (input, strict) {
    var output = '';
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;

    // if (/[^A-Za-z0-9\+\/\=]/.test(input)) return ""; // we don't need this, caller checks for us

    const k = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    while (i < input.length) {

        enc1 = k.indexOf(input.charAt(i++));
        enc2 = k.indexOf(input.charAt(i++));
        enc3 = k.indexOf(input.charAt(i++));
        enc4 = k.indexOf(input.charAt(i++));

        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;

        output += String.fromCharCode(chr1);

        if (enc3 != 64) {
          output += String.fromCharCode(chr2);
        }
        if (enc4 != 64) {
          output += String.fromCharCode(chr3);
        }

    }
    return output;

  }
};
