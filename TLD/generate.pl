#!/usr/bin/perl -w

# Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

# use strict;
use utf8;
use open ':utf8';
use Regexp::Assemble;
$dat="public_suffix_list.dat";
die(".dat file $dat not found!") unless -f "$dat";

sub generate {
  my $src = "./tld_template.js";
  my $dst = "./tld.js";
  my (@rx, @ex, $rx, $ex);
  open(DAT, $dat) || die("Cannot open $dat");
  while(<DAT>) {
    s/\./\\\./g;
    s/\s+utf.*//;
    s/[\r\n]//g;
    if(/^!/) {
      s/^!//;
      push(@ex, lc($_));
    } elsif (!/^(\/\/|[ \n\r]|$)/) {
      s/\*\\\./[^\\.]+\\./;
      push(@rx, lc($_));
    }
  }
  close(DAT);

  #$o = Regexp::Optimizer->new;
  #$o = Regexp::List->new;
  $o = Regexp::Assemble->new;
  $_ = $o->add(@rx)->as_string();
  s/\(\?-xism:(.*)\)/$1/;
  $rx = $_;
  @rx = NULL;

  $o = Regexp::Assemble->new;
  $_ = $o->add(@ex)->as_string();
  s/\(\?-xism:(.*)\)/$1/;
  $ex = $_;
  @ex = NULL;

  open(SRC, $src) || die("Cannot open $src");
  open(DST, ">$dst") || die("Cannot open $dst");
  while(<SRC>) {
    s/(_tldRx:\s*\/\(.*?\)).*?(?=\$\/)/$1$rx/s;
    s/(_tldEx:\s*\/\(.*?\)).*?(?=\$\/)/$1$ex/s;
    print DST;
  }
  close(SRC);
  close(DST);
}
generate();
