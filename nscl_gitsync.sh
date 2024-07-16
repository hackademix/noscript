#!/bin/bash
BASE="$(dirname "$0")"
NSCL_PATH="$BASE/src/nscl"
commit_range=$(git diff "$NSCL_PATH" | grep 'Subproject commit' | sed -r -e's/\+.* /../' -e's/.*commit //' | tr -d '\n')
if ! [[ $commit_range ]]; then
  echo >&2 "nscl commits already in sync."
  exit 1
fi
pushd "$NSCL_PATH"
git log --oneline "$commit_range"
if ! git push ; then
  popd
  exit 1
fi
popd
git commit -m'[nscl] Updated to latest NoScript Commons Library.' "$NSCL_PATH"

