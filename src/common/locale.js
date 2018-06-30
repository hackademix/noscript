'use strict';
var _ = browser.i18n.getMessage;
var i18n = (() => {
  var i18n = {
    // derived from  http://github.com/piroor/webextensions-lib-l10n

  	updateString(aString) {
  		return aString.replace(/__MSG_(.+?)__/g, function(aMatched) {
  			var key = aMatched.slice(6, -2);
  			return _(key);
  		});
  	},
  	updateDOM(rootNode = document) {
  		var texts = document.evaluate(
  				'descendant::text()[contains(self::text(), "__MSG_")]',
  				rootNode,
  				null,
  				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
  				null
  			);
  		for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++)
  		{
  			let text = texts.snapshotItem(i);
  			text.nodeValue = this.updateString(text.nodeValue);
  		}

  		var attributes = document.evaluate(
  				'descendant::*/attribute::*[contains(., "__MSG_")]',
  				rootNode,
  				null,
  				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
  				null
  			);
  		for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++)
  		{
  			let attribute = attributes.snapshotItem(i);
  			debug('apply', attribute);
  			attribute.value = this.updateString(attribute.value);
  		}
  	}
  };

  document.addEventListener('DOMContentLoaded', e => i18n.updateDOM());
  return i18n;
})()
