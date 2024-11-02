#!/bin/bash
SRC=src/
if [[ $1 == "2" ]]; then
  mv=2
  min=128
else
  mv=3
  min=666
fi
sed -i -re 's/("manifest_version":\s*)[0-9]/\1'$mv'/' -e 's/("strict_min_version":\s*")[0-9]+/\1'$min'/' "$SRC/manifest.json"