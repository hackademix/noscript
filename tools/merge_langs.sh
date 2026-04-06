#!/bin/bash

# Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

SRC_DIR="src/_locales"
TMP_DIR="/tmp/_locales"
EN_FILE="$SRC_DIR/en/messages.json"
FILTER_FILE="$(dirname $0)/$(basename -s .sh $0).jq"

for lang_dir in "$SRC_DIR"/*/; do
  LANG=$(basename "$lang_dir")

  if [ "$LANG" == "en" ]; then
    continue
  fi

  LOCAL_FILE="$SRC_DIR/$LANG/messages.json"
  NEW_DATA_FILE="$TMP_DIR/$LANG/messages.json"

  if [ -f "$NEW_DATA_FILE" ] && [ -f "$LOCAL_FILE" ]; then
    echo "Processing $LANG..."

    # Using -f to load the logic from the separate file
    jq --slurpfile en "$EN_FILE" \
       --slurpfile tmp "$NEW_DATA_FILE" \
       -f "$FILTER_FILE" \
       "$LOCAL_FILE" > "$LOCAL_FILE.tmp" && mv "$LOCAL_FILE.tmp" "$LOCAL_FILE"
  else
    echo "Skipping $LANG: Translation file not found in $TMP_DIR"
  fi
done

echo "Done."
