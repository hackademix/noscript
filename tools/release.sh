#!/bin/bash
#
# Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

set -e

OVERWRITE=""
if [[ $1 == "-o" ]]; then
  OVERWRITE=true
  shift
fi

if ! [[ $1 =~ ^[0-9][0-9.]+$ ]]; then
  echo "Usage: $0 [-o] <version>"
  echo "-o overwrites existing assets."
  echo "Example: $0 13.5.0"
  exit 1
fi

VER="$1"
REPO="${GITHUB_REPOSITORY:-$(git config --get remote.origin.url | sed 's|.*github.com[:/]\(.*\)\.git$|\1|')}"
TOKEN="${NS_GH_RELEASE_TOKEN:?Error: NS_GH_RELEASE_TOKEN environment variable must be set}"

if [ -z "$REPO" ]; then
  echo "Error: Could not determine repository. Set GITHUB_REPOSITORY or ensure git remote is configured."
  exit 1
fi

BASE="$(git rev-parse --show-toplevel)"

find_tag() {
  local VER_SHORT="${VER%.0}"
  local VER_SHORTER="${VER_SHORT%.0}"
  local candidate
  for candidate in "$VER" "v$VER" "$VER_SHORT" "v$VER_SHORT" "$VER_SHORTER" "v$VER_SHORTER"; do
    if git tag --points-at "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
}

TAG="$(find_tag)"
if ! [[ $TAG ]]; then
  echo >&2 "Cannot find tag for $VER"
  exit 2
fi

echo "Managing release for version: $VER (tag $TAG) in repository: $REPO"

# Determine if this is a pre-release (ends with .9xx)
LAST_COMPONENT="${VER##*.}"
if [[ "$LAST_COMPONENT" =~ ^9[0-9]{2,}$ ]]; then
  PRERELEASE="true"
  SUBPATH="betas"
else
  PRERELEASE="false"
  SUBPATH="releases"
fi

echo "Pre-release: $PRERELEASE"

fetch_file() {
  local url="$1"
  local fname="$(basename "$url")"
  local cached="$BASE/xpi/$fname"
  if [[ -f $cached ]] && ( [[ $cached != *.xpi ]] || is_signed "$cached" ); then
    echo "$cached"
    return
  fi
  echo >&2 "Downloading $url"
  if curl -fsSL --retry 3 -o "$cached" "$url" >/dev/null; then
    echo "$cached"
  fi
}

# URL encode function for labels
urlencode() {
  echo -n "$1" | jq -sRr @uri
}

is_signed() {
  [ -f "$1" ] && ( unzip -l "$1" | grep "META-INF/mozilla.rsa" ) >/dev/null 2>&1;
}

# Download available assets
declare -a FILES
declare -a LABELS


FILE="$(fetch_file "https://secure.informaction.com/download/${SUBPATH}/noscript-${VER}-chrome.zip")"
if [[ $FILE ]]; then
  FILES+=("$FILE")
  LABELS+=("For Chromium (noscript.net/getit/#rc-for-chromium)")
fi

if [[ "$PRERELEASE" == "true" ]]; then
  TOR_VER="${VER}01984"
else
  TOR_VER="${VER}.1984"
fi
FILE="$(fetch_file "https://dist.torproject.org/torbrowser/noscript/noscript-${TOR_VER}.xpi")"
if [[ $FILE ]]; then
  FILES+=("$FILE")
  LABELS+=("For Firefox, auto-updated from torproject.org")
fi

FILE="$(fetch_file "https://secure.informaction.com/download/${SUBPATH}/noscript-${VER}.xpi")"
if [[ $FILE ]]; then
  FILES+=("$FILE")
  if [[ "$PRERELEASE" == "true" ]]; then
    LABELS+=("For Firefox, auto-updated from secure.informaction.com")
  else
    LABELS+=("For Firefox, auto-updated from mozilla.org")
  fi
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No assets available to upload"
  exit 1
fi

echo "Creating changelog..."
if [[ "$PRERELEASE" == "true" ]]; then
  # For pre-release: use the regular tag annotation
  if [[ -n "$TAG" ]]; then
    CHANGELOG=$(git tag -l --format='%(contents)' "$TAG")
    echo "Using annotation from tag: $TAG"
  else
    echo "Warning: No regular tag found for pre-release"
    CHANGELOG=""
  fi
else
  # For stable: fetch from changelog URL
  CHANGELOG_VER_ESCAPED="${VER//./\\.}"
  CHANGELOG=$(curl -L "https://noscript.net/changelog" 2>/dev/null | \
    grep -E -m1 -A1000 "^v? ?$CHANGELOG_VER_ESCAPED$" | \
    grep -m1 -B1000 '^$' || true)

  if [ -z "$CHANGELOG" ]; then
    echo "Warning: Could not fetch changelog from noscript.net"
  fi
fi

# Trim, format and append full changelog link
CHANGELOG="$(echo "${CHANGELOG}" | tail -n+3 | sed -re 's/^x /- /')

Full changelog at https://noscript.net/changelog"
echo "$CHANGELOG"

# Prepare release payload
RELEASE_NAME="$VER"
RELEASE_TAG="$TAG"

echo "Checking for existing release with tag: $RELEASE_TAG"
EXISTING_RELEASE=$(curl -fsSL \
  -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$REPO/releases/tags/$RELEASE_TAG" 2>/dev/null || true)

if echo "$EXISTING_RELEASE" | grep -q '"id"'; then
  RELEASE_ID=$(echo "$EXISTING_RELEASE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
  echo "Found existing release with ID: $RELEASE_ID"

  # Update release metadata
  curl -fsSL -X PATCH \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/releases/$RELEASE_ID" \
    -d "{
      \"name\": \"$RELEASE_NAME\",
      \"body\": $(printf '%s' "$CHANGELOG" | jq -Rs .),
      \"prerelease\": $PRERELEASE
    }" > /dev/null

  echo "Updated release metadata"
else
  echo "Creating new release"

  RELEASE_RESPONSE=$(curl -fsSL -X POST \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/releases" \
    -d "{
      \"tag_name\": \"$RELEASE_TAG\",
      \"name\": \"$RELEASE_NAME\",
      \"body\": $(printf '%s' "$CHANGELOG" | jq -Rs .),
      \"prerelease\": $PRERELEASE
    }")

  RELEASE_ID=$(echo "$RELEASE_RESPONSE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
  echo "Created release with ID: $RELEASE_ID"
fi

# Upload assets
echo "Uploading assets..."
for i in "${!FILES[@]}"; do
  FILE="${FILES[$i]}"
  LABEL="${LABELS[$i]}"
  FILENAME=$(basename "$FILE")

  # URL encode the label
  ENCODED_LABEL=$(urlencode "$LABEL")

  echo "Uploading $FILENAME with label $LABEL"

  # Delete existing asset if present
  ASSET_ID=$(curl -fsSL \
     -H "Authorization: token $TOKEN" \
     "https://api.github.com/repos/$REPO/releases/$RELEASE_ID/assets" | \
     jq -r ".[] | select(.name == \"$FILENAME\") | .id" | head -1)

  if [ -n "$ASSET_ID" ] && [ "$ASSET_ID" != "null" ]; then
    if ! [[ $OVERWRITE ]]; then
      echo "Skipping existing asset: $FILENAME"
      continue
    fi
    echo "Deleting existing asset: $FILENAME"
    curl -fsSL -X DELETE \
      -H "Authorization: token $TOKEN" \
      "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID" > /dev/null
  fi

  UPLOAD_RESPONSE=$(curl -fsSL -X POST \
    -H "Authorization: token $TOKEN" \
    -H "Content-Type: application/octet-stream" \
    "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$FILENAME&label=$ENCODED_LABEL" \
    --data-binary "@$FILE" \
    -w "\n%{http_code}" || true)

  HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -1)
  RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    echo "✓ Uploaded: $FILENAME"
  else
    echo "✗ Upload failed with HTTP $HTTP_CODE"
    echo "Response: $RESPONSE_BODY"
    exit 1
  fi
done

echo "Release: https://github.com/$REPO/releases/tag/$RELEASE_TAG"
