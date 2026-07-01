import json,subprocess,re,random
from concurrent.futures import ThreadPoolExecutor
# gather unresolved (name-only) from completed scans
un=[]
for sf in ('pc_scan.json','pc_new2_scan.json','hc_all_scan.json'):
    for c in json.load(open(sf)):
        if not c.get('ats'): un.append(c['name'])
random.seed(7); random.shuffle(un)
sample=un[:45]
def curl(u,t=12):
    try:return subprocess.run(['curl','-sSL','--max-time',str(t),'-A','Mozilla/5.0','-w','\n#HTTP:%{http_code}#URL:%{url_effective}',u],capture_output=True,text=True,timeout=t+3).stdout
    except:return ''
ATS=[('workday','myworkdayjobs|workday'),('greenhouse','greenhouse|grnh.se'),('lever','lever.co'),
     ('ashby','ashbyhq'),('smartrecruiters','smartrecruiters'),('workable','workable'),('rippling','rippling'),
     ('icims','icims'),('taleo','taleo'),('jobvite','jobvite'),('bamboohr','bamboohr'),('teamtailor','teamtailor'),
     ('jazzhr','jazz.co|applytojob'),('breezy','breezy.hr'),('paylocity','paylocity'),('adp','workforcenow|adp'),
     ('gusto','gusto'),('personio','personio'),('successfactors','successfactors|sapsf'),('paycom','paycom'),('wellfound','wellfound|angel.co')]
def diag(name):
    slug=re.sub(r'[^a-z0-9]','',name.lower())
    for dom in (f'https://www.{slug}.com/careers', f'https://{slug}.com/careers', f'https://www.{slug}.com/jobs'):
        r=curl(dom)
        if not r: continue
        m=re.search(r'#HTTP:(\d+)#URL:(.*)$',r); code=m.group(1) if m else '?'; final=m.group(2) if m else ''
        low=r.lower()
        if code in ('000','404') and 'careers' in dom and dom.endswith('careers'): 
            # try homepage
            pass
        for label,pat in ATS:
            if re.search(pat,low):
                return name,f'ATS={label}',code
        if code=='000': return name,'no-site/dead',code
        if code=='404': continue
        if 'careers' in low or 'job' in low or 'hiring' in low: return name,'custom/other-careers',code
        return name,'live-no-ats-detected',code
    return name,'unreachable/dead',''
with ThreadPoolExecutor(max_workers=12) as ex: res=list(ex.map(diag,sample))
from collections import Counter
cat=Counter(r[1].split('=')[0] if r[1].startswith('ATS') else r[1] for r in res)
ats=Counter(r[1] for r in res if r[1].startswith('ATS'))
print("=== WHY UNRESOLVED (sample of 45) ===")
for k,v in cat.most_common(): print(f"  {v:2}  {k}")
print("\nATS platforms detected on unresolved cos:")
for k,v in ats.most_common(): print(f"  {v:2}  {k}")
print("\nexamples:")
for r in res[:22]: print(f"  {r[0][:26]:26} -> {r[1]} ({r[2]})")
