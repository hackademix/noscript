/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2021 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

XSS.FlashIdiocy = {
 _affectsRx: /%(?:[8-9a-f]|[0-7]?[^0-9a-f])/i, // high (non-ASCII) percent encoding or invalid second digit
 affects(s) {
   return this._affectsRx.test(s);
 },

 purgeBadEncodings(s) {
   return s.replace(/%(?:[0-9a-f]?(?:[^0-9a-f]|$))/ig, "");
 },

 platformDecode(s) {
   return s.replace(/%[8-9a-f][0-9a-f]/ig, s => this.map[s.substring(1).toLowerCase()]);
 },

 map: {
    "80": "?",
    "81": "",
    "82": "?",
    "83": "?",
    "84": "?",
    "85": "?",
    "86": "?",
    "87": "?",
    "88": "?",
    "89": "?",
    "8a": "?",
    "8b": "?",
    "8c": "?",
    "8d": "",
    "8e": "?",
    "8f": "",
    "90": "",
    "91": "?",
    "92": "?",
    "93": "?",
    "94": "?",
    "95": "?",
    "96": "?",
    "97": "?",
    "98": "?",
    "99": "?",
    "9a": "?",
    "9b": "?",
    "9c": "?",
    "9d": "",
    "9e": "?",
    "9f": "?",
    "a0": " ",
    "a1": "¡",
    "a2": "¢",
    "a3": "£",
    "a4": "¤",
    "a5": "¥",
    "a6": "¦",
    "a7": "§",
    "a8": "¨",
    "a9": "©",
    "aa": "ª",
    "ab": "«",
    "ac": "¬",
    "ad": "­",
    "ae": "®",
    "af": "¯",
    "b0": "°",
    "b1": "±",
    "b2": "²",
    "b3": "³",
    "b4": "´",
    "b5": "µ",
    "b6": "¶",
    "b7": "·",
    "b8": "¸",
    "b9": "¹",
    "ba": "º",
    "bb": "»",
    "bc": "¼",
    "bd": "½",
    "be": "¾",
    "bf": "¿",
    "c0": "À",
    "c1": "Á",
    "c2": "Â",
    "c3": "Ã",
    "c4": "Ä",
    "c5": "Å",
    "c6": "Æ",
    "c7": "Ç",
    "c8": "È",
    "c9": "É",
    "ca": "Ê",
    "cb": "Ë",
    "cc": "Ì",
    "cd": "Í",
    "ce": "Î",
    "cf": "Ï",
    "d0": "Ð",
    "d1": "Ñ",
    "d2": "Ò",
    "d3": "Ó",
    "d4": "Ô",
    "d5": "Õ",
    "d6": "Ö",
    "d7": "×",
    "d8": "Ø",
    "d9": "Ù",
    "da": "Ú",
    "db": "Û",
    "dc": "Ü",
    "dd": "Ý",
    "de": "Þ",
    "df": "ß",
    "e0": "à",
    "e1": "á",
    "e2": "â",
    "e3": "ã",
    "e4": "ä",
    "e5": "å",
    "e6": "æ",
    "e7": "ç",
    "e8": "è",
    "e9": "é",
    "ea": "ê",
    "eb": "ë",
    "ec": "ì",
    "ed": "í",
    "ee": "î",
    "ef": "ï",
    "f0": "ð",
    "f1": "ñ",
    "f2": "ò",
    "f3": "ó",
    "f4": "ô",
    "f5": "õ",
    "f6": "ö",
    "f7": "÷",
    "f8": "ø",
    "f9": "ù",
    "fa": "ú",
    "fb": "û",
    "fc": "ü",
    "fd": "ý",
    "fe": "þ",
    "ff": "ÿ",
 }
};
