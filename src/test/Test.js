var Test = (() => {
  'use strict';
  return {
    passed: 0,
    failed: 0,
    async include(tests) {
      for(let test of tests) {
        let src = `/test/${test}_test.js`;
        log(`Testing ${test}`);
        this.passed = this.failed = 0;
        try {
          await include(src);
        } catch (e) {
          // we might omit some tests in publicly available code for Security
          // reasons, e.g. XSS_test.js
          log("Missing test ", test);
          continue;
        }
      }
    },
    async run(test, msg = "", callback = null) {
      let r = false;
      try {
        r = await test();
      } catch(e) {
        error(e);
      }
      this[r ? "passed" : "failed"]++;
      log(`${r ? "PASSED" : "FAILED"} ${msg || test}`);
      if (typeof callback === "function") try {
        callback(r, test, msg);
      } catch(e) {
        error(e);
      }
    },

    report() {
      let {passed, failed} = this;
      log(`FAILED: ${failed}, PASSED: ${passed}, TOTAL ${passed + failed}.`);
    }
  };

})();
