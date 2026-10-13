#!/bin/bash

# Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

for branch in esr115 esr140 main; do
  # remove cache
  rm html5_events.re
  ./html5_events.pl "$branch"
done
