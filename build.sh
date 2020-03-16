#!/bin/bash
BASE="$PWD"
SRC="$BASE/src"
BUILD="$BASE/build"
CHROMIUM="$BASE/chromium"
MANIFEST_IN="$SRC/manifest.json"
MANIFEST_OUT="$BUILD/manifest.json"

strip_rc_ver() {
  MANIFEST="$1"
  if [[ "$2" == "rel" ]]; then
    replace='s/("version":.*)rc\d+/$1/'
  else
    replace='s/("version":.*)(\d+)rc(\d+)/{$1 . ($2 == "0" ? "0" : ($2-1) . ".9" . sprintf("%03d", $3))}/e'
  fi
  perl -pi.bak -e "$replace" "$MANIFEST" && rm -f "$MANIFEST".bak
}

VER=$(grep '"version":' "$MANIFEST_IN" | sed -re 's/.*": "(.*?)".*/\1/')
if [ "$1" == "tag" ]; then
  echo "Tagging at $VER"
  git tag -a "$VER" && git push origin "$VER"
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
TLD="$BASE/TLD"

if ! [ $(date -r "$LIB/tld.js"  +'%Y%m%d') -ge $(date +'%Y%m%d') -a "$1" != "tld" ] && "$TLD/generate.sh" "$LIB/tld.js"; then
  cp -u "$TLD/tld.js" "$LIB"
fi

./html5_events/html5_events.pl

rm -rf "$BUILD" "$XPI"
cp -pR "$SRC" "$BUILD"
cp -p LICENSE.txt GPL.txt "$BUILD"/

BUILD_CMD="web-ext"
BUILD_OPTS="build --overwrite-dest"
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
  for file in "$SRC"/content/*.js; do
    if grep -P '\/\/\s(REL|DEV)_ONLY' "$file" >/dev/null; then
      sed -re 's/\s*\/\/\s*(\S.*)\s*\/\/\s*REL_ONLY.*/\1/' -e 's/.*\/\/\s*DEV_ONLY.*//' "$file" > "$BUILD/content/$(basename "$file")"
    fi
  done
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

COMMON_BUILD_OPTS="--ignore-files=test/XSS_test.js"

"$BUILD_CMD" $BUILD_OPTS --source-dir="$WEBEXT_IN" --artifacts-dir="$WEBEXT_OUT" $COMMON_BUILD_OPTS
SIGNED="$XPI_DIR/noscript_security_suite-$VER-an+fx.xpi"
if [ -f "$SIGNED" ]; then
  mv "$SIGNED" "$XPI.xpi"
  ../../we-publish "$XPI.xpi"
elif [ -f "$XPI.zip" ]; then
  [[ "$VER" == *rc* ]] && xpicmd="mv" || xpicmd="cp"
  $xpicmd "$XPI.zip" "$XPI.xpi"
else
  echo >&2 "ERROR: Could not create $XPI.xpi!"
  exit 3
fi
echo "Created $XPI.xpi"
ln -fs $XPI.xpi "$BASE/latest.xpi"
# create chromium pre-release
rm -rf "$CHROMIUM"
strip_rc_ver "$MANIFEST_OUT"
# skip "application" manifest key
(grep -B1000 '"name": "NoScript"' "$MANIFEST_OUT"; \
  grep -A2000 '"version":' "$MANIFEST_OUT") > "$MANIFEST_OUT".tmp && \
  mv "$MANIFEST_OUT.tmp" "$MANIFEST_OUT"
mv "$BUILD" "$CHROMIUM"
web-ext $CHROMIUM_BUILD_OPTS --source-dir="$CHROMIUM" --artifacts-dir="$WEBEXT_OUT" $COMMON_BUILD_OPTS
