import json,subprocess,re
from concurrent.futures import ThreadPoolExecutor,as_completed
un={}
for sf in ['hc_all_scan.json','pc_scan.json','pc_new_scan.json','pc_new2_scan.json']:
    for c in json.load(open(sf)):
        if not c.get('ats'): un[re.sub(r'[^a-z0-9]','',c['name'].lower())]=c
un=list(un.values())
def curl(u,t=4):
    try:return subprocess.run(['curl','-sSL','--max-time',str(t),'-A','Mozilla/5.0',u],capture_output=True,text=True,timeout=t+2).stdout
    except:return ''
PAT=[('greenhouse',re.compile(r'(?:boards|job-boards)\.(?:eu\.)?greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_]{2,40})',re.I)),
     ('lever',re.compile(r'jobs\.(?:eu\.)?lever\.co/([a-z0-9-]{2,40})',re.I)),
     ('ashby',re.compile(r'jobs\.ashbyhq\.com/([a-z0-9-]{2,40})',re.I)),
     ('workable',re.compile(r'([a-z0-9-]{2,40})\.workable\.com',re.I)),
     ('smartrecruiters',re.compile(r'(?:jobs|careers)\.smartrecruiters\.com/([a-zA-Z0-9]{2,40})')),
     ('rippling',re.compile(r'ats\.rippling\.com/([a-z0-9-]{2,40})',re.I))]
STOP={'www','job','jobs','careers','embed','static','assets','cdn','api'}
def find(name):
    slug=re.sub(r'[^a-z0-9]','',name.lower())
    for dom in (f'{slug}.com',f'{slug}.ai',f'{slug}.io'):
        for path in ('/careers',''):
            b=curl(f'https://www.{dom}{path}')
            if not b: continue
            for ats,pat in PAT:
                m=pat.search(b)
                if m and m.group(1).lower() not in STOP: return ats,m.group(1)
            break
    return None,None
FETCH={'greenhouse':lambda t:('https://boards-api.greenhouse.io/v1/boards/%s/jobs?content=true'%t,'{','jobs'),
 'lever':lambda t:('https://api.lever.co/v0/postings/%s?mode=json'%t,'[',None),
 'ashby':lambda t:('https://api.ashbyhq.com/posting-api/job-board/%s?includeCompensation=true'%t,'{','jobs'),
 'workable':lambda t:('https://apply.workable.com/api/v1/widget/accounts/%s?details=true'%t,'{','jobs'),
 'smartrecruiters':lambda t:('https://api.smartrecruiters.com/v1/companies/%s/postings?limit=100'%t,'{','content'),
 'rippling':lambda t:('https://api.rippling.com/platform/api/ats/v1/board/%s/jobs'%t,'[',None)}
def jobs(ats,tok):
    url,pfx,key=FETCH[ats](tok); r=curl(url,6)
    if not r.startswith(pfx): return []
    try:
        d=json.loads(r); return (d.get(key,[]) if key else d) or []
    except: return []
done=[0]
def rec(c):
    ats,tok=find(c['name'])
    if ats and tok:
        j=jobs(ats,tok)
        if j: c.update(ats=ats,ats_token=tok,raw_jobs=j)
    done[0]+=1
    if done[0]%200==0: print("...%d/%d"%(done[0],len(un)),flush=True)
    return c
res=[]
with ThreadPoolExecutor(max_workers=24) as ex:
    for f in as_completed([ex.submit(rec,c) for c in un]): res.append(f.result())
got=[c for c in res if c.get('ats')]
json.dump(got,open('recovered_scan.json','w'))
print("DONE: probed %d | recovered %d | jobs %d"%(len(un),len(got),sum(len(c['raw_jobs']) for c in got)),flush=True)
