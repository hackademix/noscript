#!/bin/bash

# Copyright (C) 2021 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

files=$(reuse lint | grep -A1000 '# MISSING ' | grep -B1000 '# SUMMARY' | grep -e '^* ' | cut -c3-)
YEAR=2005-$(date +%Y)
COPY="Giorgio Maone <https://maone.net>"
CSTYLE="string-c"
LIC="GPL-3.0-or-later"
JS_FILES=$(echo "$files" | grep -ve '\.js$')
NON_JS_FILES=$(echo "$files" | grep -e '\.js$')
if [[ "$JS_FILES" || "$NON_JS_FILES" ]]; then
  [[ "$JS_FILES" ]] && reuse addheader --year "$YEAR" --copyright-style "$CSTYLE" --copyright "$COPY" --license "$LIC" $JS_FILES
  [[ "$NON_JS_FILES" ]] && reuse addheader --year "$YEAR" --copyright-style "$CSTYLE" --copyright "$COPY" --license "$LIC" --template 'fsf-js' $NON_JS_FILES
fi
reuse lint