#!/bin/bash
BASE=$PWD
SRC="$BASE/src"
BUILD="$BASE/build"
MANIFEST_IN="$SRC/manifest.json"
MANIFEST_OUT="$BUILD/manifest.json"

VER=$(grep '"version":' "$MANIFEST_IN" | sed -re 's/.*": "(.*?)".*/\1/')
if [ "$1" == "tag" ]; then
  echo "Tagging at $VER"
  git tag -a "$VER" && git push origin "$VER"
  exit 0
fi
if [ "$1" == "bump" ]; then
  echo "Bumping to $VER"
  git add "$MANIFEST_IN"
  git commit -m "Version bump: $VER."
  exit 0
fi
XPI_DIR="$BASE/xpi"
XPI="$XPI_DIR/noscript-$VER"
LIB="$SRC/lib"
TLD="$BASE/TLD"

if ! [ $(date -r "$LIB/tld.js"  +'%Y%m%d') -ge $(date +'%Y%m%d') ] && "$TLD/generate.sh"; then
  cp -u "$TLD/tld.js" $LIB
fi

./html5_events/html5_events.pl

rm -rf "$BUILD" "$XPI"
cp -pR "$SRC" "$BUILD"
cp -p LICENSE.txt GPL.txt "$BUILD"/

if [[ $VER == *rc* ]]; then
  sed -re 's/^(\s+)"strict_min_version":.*$/\1"update_url": "https:\/\/secure.informaction.com\/update\/?v='$VER'",\n\0/' \
    "$MANIFEST_IN" > "$MANIFEST_OUT"
else
  grep -v '"update_url":' "$MANIFEST_IN" > "$MANIFEST_OUT"
fi
if ! grep '"id":' "$MANIFEST_OUT" >/dev/null; then
  echo >&2 "Cannot build manifest.json"
  exit 1
fi

sed -re 's/\/\/\s*(.*)\s*\/\/ XPI_ONLY/\1/' $SRC/content/content.js > $BUILD/content/content.js

if [ "$1" == "sign" ]; then
  BUILD_CMD="$BASE/../../we-sign"
  BUILD_OPTS=""
else
  BUILD_CMD="web-ext"
  BUILD_OPTS="build"
fi

echo "Creating $XPI.xpi..."
mkdir -p "$XPI_DIR"

"$BUILD_CMD" $BUILD_OPTS --source-dir=$(cygpath -w $BUILD) --artifacts-dir=$(cygpath -w $XPI_DIR) --ignore-files=test/XSS_test.js
SIGNED="$XPI_DIR/noscript_security_suite-$VER-an+fx.xpi"
if [ -f "$SIGNED" ]; then
  mv "$SIGNED" "$XPI.xpi"
elif [ -f "$XPI.zip" ]; then
  mv "$XPI.zip" "$XPI.xpi"
else
  echo >&2 "ERROR: Could not create $XPI.xpi!"
  exit 3
fi
echo "Created $XPI.xpi"
rm -rf "$BUILD"
