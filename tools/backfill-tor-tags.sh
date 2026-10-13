#! /usr/bin/env bash
# backfill-tor-tags.sh
#

# Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

#!/usr/bin/env bash
# backfill-tor-tags.sh
#
# For every XPI on dist.torproject.org/torbrowser/noscript/ that does NOT
# already have a corresponding *1984 git tag in this repo, find the commit
# that matches the regular version tag and push a new *1984 tag to origin.
#
# Run from the root of the noscript git repo.
# Usage: bash tools/backfill-tor-tags.sh [--dry-run]

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

BASE="$(git rev-parse --show-toplevel)"
TOR_INDEX_URL="https://dist.torproject.org/torbrowser/noscript/"

echo "Fetching Tor dist index..."
INDEX=$(curl -fsSL "$TOR_INDEX_URL")

TOR_TAGS=$(echo "$INDEX" \
  | grep -oP '(?<=noscript-)[\d.]+1984(?=\.xpi)' \
  | sort -V \
  | uniq)

if [[ -z "$TOR_TAGS" ]]; then
  echo "ERROR: No *1984 XPI versions found in index. Check URL or page format." >&2
  exit 1
fi

echo "Found $(echo "$TOR_TAGS" | wc -l) Tor XPI version(s) on dist.torproject.org."

git -C "$BASE" fetch --tags --quiet origin 2>/dev/null || true
EXISTING_TAGS=$(git -C "$BASE" tag -l)

skipped=0; tagged=0; missing_regular=0; already=0

for TOR_TAG in $TOR_TAGS; do

  if echo "$EXISTING_TAGS" | grep -qxF "$TOR_TAG"; then
    echo "SKIP (already tagged): $TOR_TAG"
    (( already++ )) || true
    continue
  fi

  # Derive the regular version from the Tor tag.
  # The Tor suffix is always "0?1984" where the boundary with the regular
  # version is:
  #   - a dot for stable releases:     13.6.15.1984     → 13.6.15
  #                                    13.5.902.1984    → 13.5.902
  #   - a literal 0 for pre-releases:  13.6.15.90101984 → 13.6.15.901
  #                                    13.5.1.90201984  → 13.5.1.902
  # Pre-release tags end in 0…1984 (e.g. 90101984); stable tags end in .1984.
  # Two suffix strips cover both; each is a no-op on the other case.
  VER="${TOR_TAG%01984}"
  VER="${VER%.1984}"

  if [[ "$VER" == "$TOR_TAG" ]]; then
    echo "SKIP (unexpected format, could not derive regular version): $TOR_TAG" >&2
    (( skipped++ )) || true
    continue
  fi

  # The regular tag may omit trailing .0 components (e.g. tor "13.5.0.1984"
  # → VER "13.5.0" but regular tag is just "13.5"), so also try with those stripped.
  VER_SHORT="${VER%.0}"  # strip one trailing .0; repeat for pathological cases
  VER_SHORTER="${VER_SHORT%.0}"

  REG_TAG=""
  for candidate in "$VER" "v$VER" "$VER_SHORT" "v$VER_SHORT" "$VER_SHORTER" "v$VER_SHORTER"; do
    if echo "$EXISTING_TAGS" | grep -qxF "$candidate"; then
      REG_TAG="$candidate"
      break
    fi
  done

  if [[ -z "$REG_TAG" ]]; then
    echo "SKIP (no regular tag for '$VER'): $TOR_TAG"
    (( missing_regular++ )) || true
    continue
  fi

  COMMIT=$(git -C "$BASE" rev-list -n1 "$REG_TAG" 2>/dev/null || true)
  if [[ -z "$COMMIT" ]]; then
    echo "SKIP (cannot resolve commit for tag '$REG_TAG'): $TOR_TAG" >&2
    (( skipped++ )) || true
    continue
  fi

  echo "TAGGING $TOR_TAG → $COMMIT (regular tag: $REG_TAG)"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] git tag '$TOR_TAG' '$COMMIT'"
    echo "  [dry-run] git push origin '$TOR_TAG'"
  else
    git -C "$BASE" tag "$TOR_TAG" "$COMMIT"
    git -C "$BASE" push origin "$TOR_TAG"
    echo "  ✓ pushed $TOR_TAG"
  fi

  (( tagged++ )) || true

done

echo ""
echo "Done."
echo "  Already had tag : $already"
echo "  Newly tagged    : $tagged"
echo "  No regular tag  : $missing_regular"
echo "  Skipped (other) : $skipped"

if [[ $missing_regular -gt 0 ]]; then
  echo "$missing_regular Tor version(s) had no matching regular git tag (likely pre-repo history)."
fi
