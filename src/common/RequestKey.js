'use strict';

var RequestKey = {
  create(url, type, documentOrigin) {
    return `${type}@${url}<${documentOrigin}`;
  },

  explode(requestKey) {
    let [, type, url, documentOrigin] = /(\w+)@([^<]+)<(.*)/.exec(requestKey);
    return {url, type, documentOrigin};
  }
};
