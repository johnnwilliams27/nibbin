#!/usr/bin/env python3
"""Re-probe UNRESOLVED companies across extra ATS backends: SmartRecruiters, Workable, Rippling
(+ greenhouse job-boards variant). Stores raw jobs in a normalized-enough form."""
import json, subprocess, re, sys
from concurrent.futures import ThreadPoolExecutor

def curl(u,t=15):
    try: return subprocess.run(['curl','-sS','--max-time',str(t),'-H','Accept: application/json','-A','Mozilla/5.0',u],
                               capture_output=True,text=True,timeout=t+4).stdout
    except: return ''

def toks(c):
    cand=list(c.get('tokens') or [])
    if 'domain' in c and c['domain']:
        base=c['domain'].split('.')[0]; cand=[base,base.replace('-','')]+cand
    # from name
    b=re.sub(r'[^a-z0-9 ]','',c['name'].lower()).strip()
    cand += [b.replace(' ',''), b.replace(' ','-')]
    # dedupe, drop over-generic short/common
    STOP={'us','arch','bird','blue','indigo','spade','catena','bloom','ethic','profound','galileo','maven','sana','check','color','honor','loop','bridge','arc','alta','axiom','beam','anar','away','born','brik','coast','circle'}
    out=[]
    for s in cand:
        s=s.strip()
        if len(s)>=4 and s not in STOP and s not in out: out.append(s)
    return out[:4]

def probe(c):
    for s in toks(c):
        # SmartRecruiters
        sr=curl(f'https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100')
        if sr.startswith('{'):
            try:
                d=json.loads(sr)
                if d.get('content'): c.update(ats='smartrecruiters',ats_token=s,raw_jobs=d['content']); return c
            except: pass
        # Workable widget
        wk=curl(f'https://apply.workable.com/api/v1/widget/accounts/{s}?details=true')
        if wk.startswith('{'):
            try:
                d=json.loads(wk); jobs=d.get('jobs') or d.get('results') or []
                if jobs: c.update(ats='workable',ats_token=s,raw_jobs=jobs); return c
            except: pass
        # Rippling
        rp=curl(f'https://api.rippling.com/platform/api/ats/v1/board/{s}/jobs')
        if rp.startswith('['):
            try:
                d=json.loads(rp)
                if d: c.update(ats='rippling',ats_token=s,raw_jobs=d); return c
            except: pass
        # greenhouse job-boards alt host token
        gh=curl(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true')
        if gh.startswith('{'):
            try:
                d=json.loads(gh)
                if d.get('jobs'): c.update(ats='greenhouse',ats_token=s,raw_jobs=d['jobs']); return c
            except: pass
    c.update(ats=None,ats_token=None,raw_jobs=[]); return c

def title_of(ats,j):
    if ats=='smartrecruiters': return j.get('name','')
    if ats=='workable': return j.get('title','')
    if ats=='rippling': return j.get('name','')
    return j.get('title') or j.get('text') or ''

src=json.load(open(sys.argv[1]))
unresolved=[c for c in src if not c.get('ats')]
with ThreadPoolExecutor(max_workers=10) as ex:
    res=list(ex.map(probe, unresolved))
newly=[c for c in res if c['ats']]
FIN=re.compile(r'\b(fp&a|financial planning|strategic finance|corporate finance|finance & strategy|finance and strategy)\b',re.I)
print(f"re-probed {len(res)} unresolved | newly resolved: {len(newly)}")
finhits=[]
for c in newly:
    fins=[title_of(c['ats'],j) for j in c['raw_jobs'] if FIN.search(title_of(c['ats'],j))]
    tag=f" [FP&A: {fins}]" if fins else ""
    print(f"  {c['name']:24} -> {c['ats']}/{c['ats_token']} ({len(c['raw_jobs'])} jobs){tag}")
    if fins: finhits.append(c['name'])
print("\ncompanies w/ FP&A-title roles among newly resolved:", finhits or "none")
json.dump(res, open(sys.argv[2],'w'))
