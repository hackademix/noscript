#!/bin/bash

# Copyright (C) 2005-2024 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

ARCHIVE=html5_events_archive.txt
if [ -f "$ARCHIVE" ]; then
  echo >&2 "$ARCHIVE already exists!"
  exit 1
fi
cat historical/*_events.txt | sort | uniq | egrep -v '^only$' > "$ARCHIVE"
echo "$ARCHIVE generated."