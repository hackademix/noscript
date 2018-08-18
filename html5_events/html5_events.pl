#!/usr/bin/perl
use strict;

require LWP::UserAgent;
use LWP::Simple;
use RegExp::List;
use File::stat;
use File::Basename;
use List::MoreUtils qw(uniq);

my $HTML_ATOMS_URL = "https://hg.mozilla.org/mozilla-central/raw-file/tip/xpcom/ds/StaticAtoms.py";

my $HERE = dirname($0);
my $SOURCE_FILE = "$HERE/../src/xss/InjectionChecker.js";

sub create_re
{
  my $cache = "$HERE/html5_events.re";
  my $archive = "$HERE/html5_events_archive.txt";
  
  my $sb = stat($cache);

  if ($sb && time() - $sb->mtime < 86400)
  {
    open IN, "<$cache";
    my @content = <IN>;
    close IN;
    return $content[0];
  }
  
  sub fetch_url
  {
    my $url = shift(@_);
    my $ua = LWP::UserAgent->new;
    $ua->agent('Mozilla/5.0');
     $ua->ssl_opts('verify_hostname' => 0);
    my $res = $ua->get($url);
    if ($res->is_success)
    {
     return $res->decoded_content;
    }
    else
    {
      my $err = $res->content;
      my $ca_file = $ua->ssl_opts('SSL_ca_file');
      die ("Could not fetch $url: $err\n$ca_file");
    }
  }


  my $content = fetch_url($HTML_ATOMS_URL);

  $content = join("\n", grep(/^\s*Atom\("on\w+"/, split(/[\n\r]/, $content)));

  $content =~ s/.*"(on\w+)".*/$1 /g;
  
  open IN, "<$archive";
  my @archived = <IN>;
  close IN;

  $content .= join("\n", @archived);
  
  $content =~ s/\s+/\n/g;
  $content =~ s/^\s+|\s+$//g;
  
  my @all_events = grep(!/^only$/, uniq(split("\n", $content)));
  
  open (OUT, ">$archive");
  print OUT join("\n", @all_events);
  close OUT;
  
  my $l  = Regexp::List->new;
  my $re = $l->list2re(@all_events);
  $re =~ s/\(\?[-^]\w+:(.*)\)/$1/;
  
  open (OUT, ">$cache");
  print OUT $re;
  close OUT;
  
  $re;
}

sub patch
{
  my $src = shift;
  my $dst = "$src.tmp";
  my $re = create_re();
  my $must_replace = 0;
  print "Patching $src...\n";
  open IN, "<$src" or die ("Can't open $src!");
  open OUT, ">$dst"  or die ("Can't open $dst!");

  while (<IN>)
  {
    my $line = $_;
    $must_replace = $line ne $_ if s/^(\s*const IC_EVENT_PATTERN\s*=\s*")([^"]+)/$1$re/;

    print OUT $_;
  }
  close IN;
  close OUT;

  if ($must_replace) {
    rename $dst, $src;
    print "Patched.\n";
  }
  else
  {
    unlink $dst;
    print "Nothing to do.\n";
  }
}

patch($SOURCE_FILE);
