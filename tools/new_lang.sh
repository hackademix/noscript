#!/bin/bash

if ! [[ $1 ]]; then
  echo >&2 "Usage: $0 <lang_code1> [<lang_code2>...]"
  exit 1
fi

ROOT=$(dirname "$0")/../
LOC_DIR="$ROOT/src/_locales"
MSG=""
while [[ $1 ]]; do
  if ! [[ $1 =~ ^[a-z]{2}(_[A-Z]${2})?$ ]]; then
    echo >&2 "$1 doesn't look like a lang code, skipping."
  fi
  LN="$1"
  LN_DIR="$LOC_DIR/$LN"
  LN_FILE="$LN_DIR/messages.json"
  shift
  if [[ -f  "$LN_FILE" ]]; then
    echo >&2 "$LN_FILE exists, skipping"
    continue
  fi
  mkdir -p "$LN_DIR"
  echo >"$LN_FILE" '{}'
  echo "Created $LN_FILE."
  if ! [[ $MSG ]]; then
    MSG="[l10n] Added new empty $LN"
  else
    MSG="$MSG, $LN"
  fi
  git add "$LN_FILE"
done

if [[ $MSG ]]; then
  git commit -m"$MSG."
fi
echo "Done."
