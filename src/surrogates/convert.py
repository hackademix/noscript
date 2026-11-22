__license__="Unlicense"
__copyright__="""This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org/>
"""

import re
import json
from functools import partial
from collections import defaultdict
from pathlib import Path, PurePosixPath

try:
	from tqdm import tqdm
except:
	def tqdm(*args, **kwargs):
		return arg[0]


thisDir=Path(__file__).parent.absolute()
addonDir=thisDir.parent
legacyDir=addonDir / "legacy"
preferencesFile=legacyDir / "defaults.js"
assetsFile=thisDir/"assets.json"

srx=re.compile('^(.*Legacy\\.migrated\\.prefs\\s*=\\s*Object\\.assign\\s*\\(\\s*)(\\{.+\\})(\s*,.+)$', re.DOTALL)
srx2=re.compile('^surrogate\\.(.+?)\\.(sources|replacement|exceptions)$')

def parsePreferences(preferencesFile:Path):
	text=None
	with preferencesFile.open("rt", encoding="utf-8") as f:
		text=f.read()
	
	pre, jsn, post=srx.match(text).groups();
	parsed=json.loads(jsn)
	
	res=defaultdict(partial(defaultdict, defaultdict))
	newF={}

	for k,v in tqdm(parsed.items(), desc="parsing "+preferencesFile.name, unit="pref"):
		m=srx2.match(k)
		if m:
			(nm, tp)=m.groups()
			res[nm][tp]=v
		else:
			newF[k]=v
	return pre, post, res, newF

def initializeAssets(assetsFile:Path):
	if assetsFile.exists():
		with assetsFile.open("rt", encoding="utf-8") as f:
			assets=json.load(f)
	else:
		assets={}
		assets["assets.json"]={
			"content": "internal",
			"title": "surrogates list",
			"updateAfter": 0,
			"contentURL": [
				str(PurePosixPath(assetsFile.relative_to(addonDir)))
			]
		}
	return assets

(pre, post, surs, newF) = parsePreferences(preferencesFile)
assets = initializeAssets(assetsFile)

for sName, s in tqdm(surs.items(), desc="dumping userscripts", unit="file"):
	mdB="// ==UserScript==\n"
	for k, v in s.items():
		if k not in {"replacement"}:
			mdB+="// @NoScript:"+k+" "+v+"\n"
	mdB+="// ==/UserScript==\n"
	fN=sName.replace(".", "_")+".user.js"
	fP=thisDir/fN
	with fP.open("wt", encoding="utf-8") as f:
		f.write(mdB)
		f.write(s["replacement"])
	
	assets[fN]={
		"content": "userscript-surrogate",
		"title": sName,
		"contentURL": [str(PurePosixPath(fP.relative_to(addonDir)))]
	}

with assetsFile.open("wt", encoding="utf-8") as f:
	json.dump(assets, f, indent="\t")

with preferencesFile.open("wt", encoding="utf-8") as f:
	f.write(pre+json.dumps(newF, indent="\t")+post)
