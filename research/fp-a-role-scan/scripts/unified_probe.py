import json,subprocess,sys
from concurrent.futures import ThreadPoolExecutor
comps=json.load(open('pc_new.json'))
def curl(u,t=12):
    try:return subprocess.run(['curl','-sS','--max-time',str(t),'-H','Accept: application/json','-A','Mozilla/5.0',u],capture_output=True,text=True,timeout=t+3).stdout
    except:return ''
def probe(c):
    for s in c['tokens']:
        if not s:continue
        gh=curl(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true')
        if gh.startswith('{'):
            try:
                d=json.loads(gh)
                if d.get('jobs'):c.update(ats='greenhouse',ats_token=s,raw_jobs=d['jobs']);return c
            except:pass
        ab=curl(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
        if ab.startswith('{'):
            try:
                d=json.loads(ab)
                if d.get('jobs'):c.update(ats='ashby',ats_token=s,raw_jobs=d['jobs']);return c
            except:pass
        lv=curl(f'https://api.lever.co/v0/postings/{s}?mode=json')
        if lv.startswith('['):
            try:
                d=json.loads(lv)
                if d:c.update(ats='lever',ats_token=s,raw_jobs=d);return c
            except:pass
        sr=curl(f'https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100')
        if sr.startswith('{'):
            try:
                d=json.loads(sr)
                if d.get('content'):c.update(ats='smartrecruiters',ats_token=s,raw_jobs=d['content']);return c
            except:pass
        wk=curl(f'https://apply.workable.com/api/v1/widget/accounts/{s}?details=true')
        if wk.startswith('{'):
            try:
                d=json.loads(wk);jobs=d.get('jobs') or d.get('results') or []
                if jobs:c.update(ats='workable',ats_token=s,raw_jobs=jobs);return c
            except:pass
        rp=curl(f'https://api.rippling.com/platform/api/ats/v1/board/{s}/jobs')
        if rp.startswith('['):
            try:
                d=json.loads(rp)
                if d:c.update(ats='rippling',ats_token=s,raw_jobs=d);return c
            except:pass
    c.update(ats=None,ats_token=None,raw_jobs=[]);return c
with ThreadPoolExecutor(max_workers=14) as ex: res=list(ex.map(probe,comps))
json.dump(res,open('pc_new_scan.json','w'))
hits=[c for c in res if c['ats']]
print(f"probed {len(res)} new | resolved {len(hits)} | jobs {sum(len(c['raw_jobs']) for c in hits)}")
