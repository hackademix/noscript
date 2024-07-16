#! /usr/bin/env bash

# Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

BASE="$PWD"
SRC="$BASE/src"
BUILD="$BASE/build"
MANIFEST_IN="$SRC/manifest.json"
MANIFEST_OUT="$BUILD/manifest.json"

strip_rc_ver() {
  MANIFEST="$1"
  if [[ "$2" == "rel" ]]; then
    replace='s/("version":.*)rc\d+/$1/'
  else
    replace='s/("version":.*?)(\d+)rc(\d+)/{$1 . ($2 == "0" ? "0" : ($2-1) . ".9" . sprintf("%03d", $3))}/e'
  fi
  perl -pi.bak -e "$replace" "$MANIFEST" && rm -f "$MANIFEST".bak
}

VER=$(grep '"version":' "$MANIFEST_IN" | sed -re 's/.*": "(.*?)".*/\1/')
if [ "$1" == "tag" ]; then
  echo "Tagging at $VER"
  git tag -a "$VER" -e -m"$(gitcl 2>/dev/null)"
  git push && git push origin "$VER"
  exit 0
fi
if [[ "$1" =~ ^r(el(ease)?)?$ ]]; then
  strip_rc_ver "$MANIFEST_IN" rel
  "$0" && "$0" bump
  exit
fi

if [[ "$1" == "bump" ]]; then
  if [[ "$2" ]]; then
    NEW_VER="$2"
    if [[ "$2" == *.* ]]; then # full dotted version number
      pattern='"\d+.*?'
      NEW_VER='"'"$2"
    elif [[ "$2" == *rc* ]]; then # new RC after release
      if [[ "$2" == rc* ]]; then
        if [[ ! "$VER" == *rc* ]]; then
          echo >&2 "Please specify next release version (like 12rc1). Current is $VER"
          exit 1
        else
          pattern='rc\d+'
        fi
      else
        pattern='\b(?:\d+rc)?\d+'
      fi
    else # incremental version
      pattern='\b\d+'
    fi
    REPLACE_EXPR='s/(?<PREAMBLE>"version":.*)'"$pattern"'"/$+{PREAMBLE}'"$NEW_VER"'"/'
    perl -pi.bak -e $REPLACE_EXPR "$MANIFEST_IN" && "$0" bump
    rm -f "$MANIFEST_IN".bak
    exit
  fi
  echo "Bumping to $VER"
  git add "$MANIFEST_IN"
  git commit -m "Version bump: $VER."
  [[ $VER == *rc* ]] || "$0" tag
  exit
fi
XPI_DIR="$BASE/xpi"
XPI="$XPI_DIR/noscript-$VER"
LIB="$SRC/lib"

NSCL="$SRC/nscl"

rm -rf "$BUILD" "$XPI"
cp -pR "$SRC" "$BUILD"

# include nscl dependencies
"$NSCL/include.sh" "$BUILD"

cp -p LICENSE "$BUILD"/

BUILD_CMD="web-ext"
BUILD_OPTS="build --overwrite-dest"
CHROMIUM_BUILD_CMD="$BUILD_CMD"
CHROMIUM_BUILD_OPTS="$BUILD_OPTS"

if [[ $VER == *rc* ]]; then
  sed -re 's/^(\s+)"strict_min_version":.*$/\1"update_url": "https:\/\/secure.informaction.com\/update\/?v='$VER'",\n\0/' \
    "$MANIFEST_IN" > "$MANIFEST_OUT"
  if [[ "$1" == "sign" ]]; then
    BUILD_CMD="$BASE/../../we-sign"
    BUILD_OPTS=""
  fi
else
  grep -v '"update_url":' "$MANIFEST_IN" > "$MANIFEST_OUT"
  if [[ "$1" == "sign" ]]; then
    echo >&2 "WARNING: won't auto-sign a release version, please manually upload to AMO."
  fi
fi
if ! grep '"id":' "$MANIFEST_OUT" >/dev/null; then
  echo >&2 "Cannot build manifest.json"
  exit 1
fi

if [ "$1" != "debug" ]; then
  DBG=""
  for file in "$SRC"/content/*.js; do
    if grep -P '\/\/\s(REL|DEV)_ONLY' "$file" >/dev/null; then
      sed -re 's/\s*\/\/\s*(\S.*)\s*\/\/\s*REL_ONLY.*/\1/' -e 's/.*\/\/\s*DEV_ONLY.*//' "$file" > "$BUILD/content/$(basename "$file")"
    fi
  done
else
  DBG="-dbg"
fi

echo "Creating $XPI.xpi..."
mkdir -p "$XPI_DIR"

if which cygpath; then
  WEBEXT_IN="$(cygpath -w "$BUILD")"
  WEBEXT_OUT="$(cygpath -w "$XPI_DIR")"
else
  WEBEXT_IN="$BUILD"
  WEBEXT_OUT="$XPI_DIR"
fi

COMMON_BUILD_OPTS="--ignore-files=test/XSS_test.js --ignore-files=content/experiments.js"

build() {
  "$BUILD_CMD" $BUILD_OPTS --source-dir="$WEBEXT_IN" --artifacts-dir="$WEBEXT_OUT" $COMMON_BUILD_OPTS
}

build

SIGNED="$XPI_DIR/noscript_security_suite-$VER-an+fx.xpi"
if [ -f "$SIGNED" ]; then
  mv "$SIGNED" "$XPI.xpi"
elif [ -f "$XPI.zip" ]; then
  SIGNED=""
  if unzip -l "$XPI.xpi" | grep "META-INF/mozilla.rsa" >/dev/null 2>&1; then
    echo "A signed $XPI.xpi already exists, not overwriting."
  else
    [[ "$VER" == *rc* ]] && xpicmd="mv" || xpicmd="cp"
    $xpicmd "$XPI.zip" "$XPI$DBG.xpi"
    echo "Created $XPI$DBG.xpi"
  fi
elif ! [ -f "$XPI.xpi" ]; then
  echo >&2 "ERROR: Could not create $XPI$DBG.xpi!"
  exit 3
fi
ln -fs "$XPI.xpi" "$BASE/latest.xpi"

# create Chromium pre-release

BUILD_CMD="$CHROMIUM_BUILD_CMD"
BUILD_OPTS="$CHROMIUM_BUILD_OPTS"
CHROMIUM_UNPACKED="$BASE/chromium"
EDGE_UPDATE_URL="https://edge.microsoft.com/extensionwebstorebase/v1/crx"
rm -rf "$CHROMIUM_UNPACKED"
strip_rc_ver "$MANIFEST_OUT"

# manifest.json patching for Chromium:

EXTRA_PERMS=""
if grep 'patchWorkers.js' "$MANIFEST_OUT" >/dev/null 2>&1; then
  EXTRA_PERMS='"debugger",'
fi

# skip "application" manifest key
(grep -B1000 '"name": "NoScript"' "$MANIFEST_OUT"; \
  grep -A2000 '"version":' "$MANIFEST_OUT") | \
  # auto-update URL for the Edge version on the Microsoft Store
  sed -e '/"name":/a\' -e '  "update_url": "'$EDGE_UPDATE_URL'",' | \
  # skip embeddingDocument.js and dns permission
  grep -Pv 'content/embeddingDocument.js|"dns",' | \
  # add "debugger" permission for patchWorkers.js
  sed -re 's/( *)"webRequestBlocking",/&\n\1'"$EXTRA_PERMS"'/' | \
  # add origin fallback for content scripts
  sed -re 's/( *)"match_about_blank": *true/\1"match_origin_as_fallback": true,\n&/' > \
  "$MANIFEST_OUT".tmp && \
  mv "$MANIFEST_OUT.tmp" "$MANIFEST_OUT"

CHROME_ZIP=$(build | grep 'ready: .*\.zip' | sed -re 's/.* ready: //')

if [ -f "$CHROME_ZIP" ]; then
  mv "$CHROME_ZIP" "$XPI$DBG-edge.zip"
  # remove Edge-specific manifest lines and package for generic Chromium
  grep -v '"update_url":' "$MANIFEST_OUT" > "$MANIFEST_OUT.tmp" && \
    mv "$MANIFEST_OUT.tmp" "$MANIFEST_OUT" && \
    build
    mv "$CHROME_ZIP" "$XPI$DBG-chrome.zip"
fi

mv "$BUILD" "$CHROMIUM_UNPACKED"

if [ "$SIGNED" ]; then
  # ensure nscl is up-to-date git-wise
  ./nscl_gitsync.sh
  "$0" tag
  nscl
  ../../we-publish "$XPI.xpi"
fi
