var Permissions = (() => {
  'use strict';
  /**
   * This class models an extensible set of browser capabilities, to be assigned to a certain site,
   * possibly tied to a set of parent sites (contextual permissions).
   * Depends on Sites.js.
   */
  class Permissions {
    /**
     * Creates a Permissions object
     * @param {Set/array} capabilities the capability enabled by this Permissions
     * @param {boolean} temp are these permissions marked as temporary (volatile?) 
     * @param {Sites/array} contextual (optional) the parent sites which these permissions are tied to  
     */
    constructor(capabilities, temp = false, contextual = null) {
      this.capabilities = new Set(capabilities);
      this.temp = temp;
      this.contextual = contextual instanceof Sites ? contextual : new Sites(contextual);
    }

    dry() {
      return {capabilities: [...this.capabilities], contextual: this.contextual.dry(), temp: this.temp};
    }

    static hydrate(dry = {}, obj = null) {
      let capabilities = new Set(dry.capabilities);
      let contextual = Sites.hydrate(dry.contextual);
      let temp = dry.temp;
      return obj ? Object.assign(obj, {capabilities, temp, contextual, _tempTwin: undefined})
                 : new Permissions(capabilities, temp, contextual);
    }

    static typed(capability, type) {
      let [capName] = capability.split(":");
      return `${capName}:${type}`;
    }

    allowing(capability) {
      return this.capabilities.has(capability);
    }

    set(capability, enabled = true) {
      if (enabled) {
        this.capabilities.add(capability);
      } else {
        this.capabilities.delete(capability);
      }
      return enabled;
    }
    sameAs(otherPerms) {
      let otherCaps = new Set(otherPerms.capabilities);
      let theseCaps = this.capabilities;
      for (let c of theseCaps) {
        if (!otherCaps.delete(c)) return false;
      }
      for (let c of otherCaps) {
        if (!theseCaps.has(c)) return false;
      }
      return true;
    }
    clone() {
      return new Permissions(this.capabilities, this.temp, this.contextual);
    }
    get tempTwin() {
      return this._tempTwin || (this._tempTwin = new Permissions(this.capabilities, true, this.contextual));
    }

  }

  Permissions.ALL = ["script", "object", "media", "frame", "font", "webgl", "fetch", "ping", "other"];
  Permissions.IMMUTABLE = {
    UNTRUSTED: {
      "script": false,
      "object": false,
      "webgl": false,
      "fetch": false,
      "other": false,
      "ping": false,
    },
    TRUSTED: {
      "script": true,
    }
  };

  Object.freeze(Permissions.ALL);

  return Permissions;
})();