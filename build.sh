#! /usr/bin/env bash

# Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

BASE="$PWD"
SRC="$BASE/src"
BUILD="$BASE/build"
MANIFEST_IN="$SRC/manifest.json"
MANIFEST_OUT="$BUILD/manifest.json"

LOCK="$BASE/.build.lock"

if [ "$1" == "watch" ]; then
  [ -f "$LOCK" ] && rm "$LOCK"
  while :; do
    if [ -f "$LOCK" ]; then
      echo >&2 "Locked on $LOCK, skipping..."
    else
      $0 -u debug
    fi
    inotifywait -e 'create,modify,move,delete' -r "$SRC"
  done
fi

cleanup() {
  rm -f "$LOCK"
}
trap cleanup SIGHUP SIGINT SIGQUIT SIGABRT EXIT
touch "$LOCK"

UNPACKED_ONLY=
if [ "$1" == '-u' ]; then
  UNPACKED_ONLY=1
  shift
fi

strip_rc_ver() {
  MANIFEST="$1"
  if [[ "$2" == "rel" ]]; then
    # release: truncate alpha/beta/rc suffixes (or *.9xx with increment)
    replace='s/("version":.*)[a-z]+\d+/$1/, s/("version":.*)\b(\d+)\.9\d{2}/{ $1 . ($2 + 1) }/e'
  else
    # turn alpha/beta/rc format into *.9xx with decrement
    replace='s/("version":.*?)\b(\d+)(?:\.0)*[a-z]+(\d+)/{ $1 . ($2 - 1) . "." .  (900 + $3) }/e'
  fi
  perl -pi.bak -e "$replace" "$MANIFEST" && rm -f "$MANIFEST".bak
}

ver_from_manifest() {
  grep '"version":' "$1" | sed -re 's/.*": "(.*?)".*/\1/'
}

VER=$(ver_from_manifest "$MANIFEST_IN")
if [ "$1" == "tag" ]; then
  # ensure nscl is up-to-date git-wise
  ./nscl_gitsync.sh
  OPTS=""
  if [ "$2" != "quiet" ]; then
    OPTS="-e"
  fi
  echo "Tagging at $VER"
  git tag -a "$VER" $OPTS -m"$(gitcl 2>/dev/null)" && git push && git push origin "$VER"
  exit 0
fi
if [[ "$1" =~ ^r(el(ease)?)?$ ]]; then
  strip_rc_ver "$MANIFEST_IN" rel
  "$0" && "$0" bump
  exit
fi

if [[ $1 == "bump" ]]; then
  if [[ $2 ]]; then
    NEW_VER="$2"
    if [[ $2 == *.* ]]; then # full dotted version number
      pattern='"\d+.*?'
      NEW_VER='"'"$2"
    elif [[ $2 == *rc* ]]; then # new RC after release
      if [[ $2 == rc* ]]; then
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
      if [[ $NEW_VER == "+" ]]; then
        # auto-increment,
        # otherwise we will assume current manifest had been manually updated
        NEW_VER=$(( ${VER/[0-9.a-z]*\./} + 1))
      fi
    fi
    REPLACE_EXPR='s/(?<PREAMBLE>"version":.*)'"$pattern"'"/$+{PREAMBLE}'"$NEW_VER"'"/'
    perl -pi.bak -e $REPLACE_EXPR "$MANIFEST_IN" && "$0" bump
    rm -f "$MANIFEST_IN".bak
    exit
  fi
  # try to add first manifest.json hunk, tentatively containing "version": ...
  INTERACTIVE=
  git diff --cached "$MANIFEST_IN" | grep '^[+-]  *"version":' \
     || echo -e "s\ns\ny\nq" | git add -p "$MANIFEST_IN" >/dev/null 2>&1
  # check whether the commit would contain more than just the version bump
  while git diff --cached "$MANIFEST_IN" | grep '^[+-] ' | grep -v '"version":'; do
    echo "Cannot commit the bump to $VER, please cleanup $MANIFEST_IN first."
    git restore --staged "$MANIFEST_IN"
    [[ $INTERACTIVE ]] && exit 1
    echo "Please try to isolate the version bump interactively:"
    INTERACTIVE=1
    git add -p "$MANIFEST_IN"
  done
  echo "Bumping to $VER"
  git commit -m "Version bump: $VER." || exit
  if ! [[ $VER =~ [^0-9.]|\.9[0-9][0-9]$ ]] ; then
    # it's a stable release: let's lock nscl and tag
    git submodule update
    "$0" tag
  fi
  exit
fi
XPI_DIR="$BASE/xpi"
XPI="$XPI_DIR/noscript-${VER}"

rm -rf "$BUILD" "$XPI"
cp -pR "$SRC" "$BUILD"
cp -p LICENSE "$BUILD"/

BUILD_CMD="web-ext"
BUILD_OPTS="build --overwrite-dest"

# save Chromium build settings from Mozilla signing overwrite
CHROMIUM_BUILD_CMD="$BUILD_CMD"
CHROMIUM_BUILD_OPTS="$BUILD_OPTS"

FIREFOX_TARGET="mv2firefox"
if [[ $1 =~ ^(sign(ed)?|tor)$ ]]; then
  BUILD_CMD="$BASE/../../we-sign"
  BUILD_OPTS=""
  FIREFOX_TARGET="$FIREFOX_TARGET:${1}"
fi

if [ "$1" != "debug" ]; then
  DBG=""
  for file in "$BUILD"/**/*.js "$BUILD"/nscl/**/*.js; do
    if grep -P '\/\/\s(REL|DEV)_ONLY' "$file" >/dev/null; then
      sed -i -r -e 's/\s*\/\/\s*(\S.*)\s*\/\/\s*REL_ONLY.*/\1/' -e 's/.*\/\/\s*DEV_ONLY.*//' "$file"
    fi
  done
else
  DBG="-dbg"
fi

UNPACKED_BASE="$BASE/unpacked"
mkdir -p "$UNPACKED_BASE"

if ! [ "$UNPACKED_ONLY" ]; then
  echo "Creating $XPI.xpi..."
  mkdir -p "$XPI_DIR"
fi

CYGPATH=$(which cypath)
COMMON_BUILD_OPTS="--ignore-files='test/**' 'embargoed/**' content/experiments.js"

fix_manifest() {
  node manifest.js "$1" "$MANIFEST_IN" "$MANIFEST_OUT" || exit 9
}

build() {
  if [[ $1 == "zip" ]]; then
    shift
  elif ! [[ $BUILD_CMD == *we-sign ]]; then
    build zip "$1" | \
      grep 'ready: .*\.zip' | sed -re 's/.* ready: //'
    return
  fi
  UNPACKED_DIR="$UNPACKED_BASE/${1:-out}"
  rm -rf "$UNPACKED_DIR"
  cp -rp "$BUILD" "$UNPACKED_DIR" && echo >&2 "Copied $BUILD to $UNPACKED_DIR"
  # include only the actually used nscl dependencies
  rm -rf "$UNPACKED_DIR/nscl"
  "$BUILD/nscl/include.sh" "$UNPACKED_DIR"

  if [[ $1 == "firefox" ]]; then
    # we use svg icons on Firefox
    rm "$UNPACKED_DIR/img/"*.png
  fi

  if [ "$UNPACKED_ONLY" ]; then
    return
  fi

  if [ "$CYGPATH" ]; then
    WEBEXT_IN="$(cygpath -w "$UNPACKED_DIR")"
    WEBEXT_OUT="$(cygpath -w "$XPI_DIR")"
  else
    WEBEXT_IN="$UNPACKED_DIR"
    WEBEXT_OUT="$XPI_DIR"
  fi

  "$BUILD_CMD" $BUILD_OPTS \
    --source-dir="$WEBEXT_IN" \
    --artifacts-dir="$WEBEXT_OUT" \
    $COMMON_BUILD_OPTS
}

fix_manifest "$FIREFOX_TARGET"
build firefox

if [[ $FIREFOX_TARGET == *:tor ]]; then
  "$BASE/tools/deploy2tor.sh" "$MANIFEST_OUT"
  exit
fi

SIGNED="$XPI_DIR/noscript_security_suite-$VER-an+fx.xpi"
if [ -f "$SIGNED" ]; then
  mv "$SIGNED" "$XPI.xpi"
elif [ -f "$XPI.zip" ]; then
  if unzip -l "$XPI.xpi" | grep "META-INF/mozilla.rsa" >/dev/null 2>&1; then
    echo "A signed $XPI.xpi already exists, not overwriting."
  else
    unset SIGNED
    cp "$XPI.zip" "$XPI$DBG.xpi"
    echo "Created $XPI$DBG.xpi"
  fi
fi
if [ -f "$XPI.xpi" ]; then
  ln -fs "$XPI.xpi" "$BASE/latest.xpi"
elif ! [ "$UNPACKED_ONLY" ]; then
  echo >&2 "ERROR: Could not create $XPI$DBG.xpi!"
  exit 3
fi



# create Chromium pre-release

BUILD_CMD="$CHROMIUM_BUILD_CMD"
BUILD_OPTS="$CHROMIUM_BUILD_OPTS"

fix_manifest mv3edge
ZIP=$(build edge)
[ -f "$ZIP" ] && mv "$ZIP" "$XPI$DBG-edge.zip"

fix_manifest mv3chrome
ZIP=$(build chromium)
[ -f "$ZIP" ] &&  mv "$ZIP" "$XPI$DBG-chrome.zip"

if [ "$SIGNED" ] && ! [ "$UNPACKED_ONLY" ]; then
  "$0" tag quiet
  nscl
  ../../we-publish "$XPI.xpi"
fi
