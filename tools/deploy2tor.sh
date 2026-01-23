#!/bin/bash
BASEDIR="$(dirname "$0")"/..
MANIFEST="${1:-$BASEDIR/unpacked/firefox/manifest.json}"
if ! [ -f "$MANIFEST" ]; then
  echo >&2 "Manifest '$1' not found!"
  exit 1
fi

from_manifest()  {
  grep "\"$1\":" "$MANIFEST" | sed -re 's/.*": "(.*?)".*/\1/'
}
XPI_DIR="$BASEDIR/xpi"
XPI_VER="$(from_manifest version)"
if ! [[ $XPI_VER = *1984 ]]; then
  echo >&2 "$XPI_VER doesn't look like a Tor Browser version!"
  exit 2
fi
XPI_FILE="noscript-${XPI_VER}.xpi"
XPI_URL="https://dist.torproject.org/torbrowser/noscript/$XPI_FILE"
if ! [ -f "$XPI_DIR/$XPI_FILE" ]; then
  echo >&2 "$XPI_DIR/$XPI_FILE not found!"
  exit 3
fi
echo "Built/signed for Tor: $XPI_DIR/$XPI_FILE"
channel="stable"
if [[ $XPI_VER =~ \.9[0-9][0-9]+$ ]]; then
  channel="pre"
fi
UPD_JSON="update-${channel}.json"
EXT_ID=$(from_manifest id)
MIN_GECKO_VER=$(from_manifest strict_min_version)
cat << EOF >"$XPI_DIR/$UPD_JSON"
{
  "addons": {
    "$EXT_ID": {
      "updates": [{
        "version": "$XPI_VER",
        "update_link": "$XPI_URL",
        "update_info_url": "https://noscript.net/feed?v=$XPI_VER",
        "applications": {
          "gecko": { "strict_min_version": "$MIN_GECKO_VER" }
        }
      }]
    }
  }
}
EOF
SRV=staticiforme.torproject.org
PORT=22
DEST="$SRV:/srv/dist-master.torproject.org/htdocs/torbrowser/noscript/"
pushd "$XPI_DIR" &&
rsync -e "ssh -p $PORT" -avuzP --delete noscript-*1984.xpi update-*.json "$DEST" &&
popd &&
ssh -p $PORT $SRV 'static-update-component dist.torproject.org'
