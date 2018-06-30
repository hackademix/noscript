#!/bin/bash
BASE=$(dirname "$0")
pushd "$BASE"
fname=public_suffix_list.dat
nflag=""
if [ -f $fname ]; then
  nflag="-z $fname"
fi
URL=https://publicsuffix.org/list/$fname
curl -O $nflag "$URL"

if ! grep 'com' $fname >/dev/null; then
  echo >&2 "$fname empty or corrupt!"
  exit 1
fi

./generate.pl
popd
