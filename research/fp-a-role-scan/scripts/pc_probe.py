import json,subprocess
from concurrent.futures import ThreadPoolExecutor
comps=json.load(open('pc_companies.json'))
def curl(u,t=18):
    try:return subprocess.run(['curl','-sS','--max-time',str(t),'-H','Accept: application/json','-A','Mozilla/5.0',u],capture_output=True,text=True,timeout=t+4).stdout
    except:return ''
def probe(c):
    for s in c['tokens']:
        if not s: continue
        gh=curl(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true')
        if gh.startswith('{'):
            try:
                d=json.loads(gh)
                if d.get('jobs'): c.update(ats='greenhouse',ats_token=s,raw_jobs=d['jobs']);return c
            except:pass
        lv=curl(f'https://api.lever.co/v0/postings/{s}?mode=json')
        if lv.startswith('['):
            try:
                d=json.loads(lv)
                if d: c.update(ats='lever',ats_token=s,raw_jobs=d);return c
            except:pass
        ab=curl(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
        if ab.startswith('{'):
            try:
                d=json.loads(ab)
                if d.get('jobs'): c.update(ats='ashby',ats_token=s,raw_jobs=d['jobs']);return c
            except:pass
    c.update(ats=None,ats_token=None,raw_jobs=[]);return c
with ThreadPoolExecutor(max_workers=10) as ex: res=list(ex.map(probe,comps))
hits=[c for c in res if c['ats']]
print(f"probed {len(res)} | resolved {len(hits)} | jobs total {sum(len(c['raw_jobs']) for c in hits)}")
for c in hits: print(f"  {c['name']:26} {c['ats']}/{c['ats_token']} ({len(c['raw_jobs'])})")
json.dump(res,open('pc_scan.json','w'))
