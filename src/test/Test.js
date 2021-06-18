/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
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
      log(`[TEST] ${r ? "PASSED" : "FAILED"} ${msg || test}`);
      if (typeof callback === "function") try {
        await callback(r, test, msg);
      } catch(e) {
        error(e, "[TEST]");
      }
    },
    report() {
      let {passed, failed} = this;
      log(`[TESTS] FAILED: ${failed}, PASSED: ${passed}, TOTAL ${passed + failed}.`);
    }
  };

})();
