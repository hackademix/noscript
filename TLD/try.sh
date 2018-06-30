#!/bin/sh
perl -ne 'if (! /^(\/\/|!|[ \n\r])/) { s/\n/\|/; s/\./\\\./g ; s/\*\\\./[^\\.]+\\./; s/\s+utf.*/|/; print }' *.dat > tld_rx.txt
perl -ne 'if (/^!/) { s/\n/\|/;  s/\./\\\./g ; s/^!//; s/\s+utf.*/|/; print }' *.dat > tld_ex.txt
