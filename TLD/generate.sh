#!/bin/bash

# Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

BASE=$(dirname "$0")
TEMPLATE=tld_template.js
if [ -f "$1" ]; then
  cp "$1" "$BASE/$TEMPLATE"
fi
pushd "$BASE" >/dev/null
fname=public_suffix_list.dat
nflag=""
if [ -f "$fname" ]; then
  nflag="-z $fname"
  cp "$fname" "$fname.bak"
fi
echo 'Updating TLDs...'
URL=https://publicsuffix.org/list/$fname
curl -sO $nflag "$URL"

if ! grep 'com' "$fname" >/dev/null; then
  echo >&2 "$fname empty or corrupt!"
  exit 1
fi

./generate.pl
[ -f "$fname.bak" ] && diff "$fname" "$fname.bak" && echo 'No new data from pubblic suffix list.'
popd >/dev/null
