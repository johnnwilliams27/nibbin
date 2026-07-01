#!/usr/bin/env python3
"""Product/exec leadership scan: Director/Head/VP Product, CPO, COO, Founding PM.
Location: Remote-US OR Dallas-Fort Worth OR San Francisco. Eligible with 12 yrs (stated min <=12)."""
import json, glob, re, csv, datetime, html
TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FUND_LABEL={'a16z':'a16z','sequoia':'Sequoia','lightspeed':'Lightspeed','greylock':'Greylock',
 'bessemer':'Bessemer','kleiner':'Kleiner Perkins','battery':'Battery','gv':'GV','felicis':'Felicis'}

PROD=re.compile(r'(director of product|head of product|chief product officer|\bcpo\b|(?:vp|svp|evp|vice president)[\s,]+(?:of\s+)?product|chief operating officer|\bcoo\b|founding product manager|founding pm)\b',re.I)
PROD_EXCL=re.compile(r'chief of staff|product design|product marketing|product support|product operations|product ops|\bdesigner\b|product analyst|data product|product counsel|product security|technical product marketing|product finance|product-led growth|growth marketing|product engineer|executive assistant|office of the|assistant to the|product line management',re.I)

US_STATES=set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming columbia".split())
US_CITIES=set("san francisco new york nyc sf seattle austin boston chicago denver atlanta dallas los angeles la miami tempe oakland mountain view palo alto redwood san mateo washington dc arlington philadelphia".split())
FOREIGN=re.compile(r'\b(canada|toronto|vancouver|london|dublin|ireland|paris|france|munich|germany|berlin|tel aviv|israel|singapore|seoul|korea|india|bangalore|uk|united kingdom|emea|apac|latam|amsterdam|netherlands|sydney|australia|remote canada|mexico city|brazil|tokyo|japan)\b',re.I)
HYBRID_JD=re.compile(r'hybrid work model|days? (?:a|per) week in|in[- ]office|this role is based in|based in our|based out of our|relocation assistance|onsite|on-site',re.I)
REMOTE_JD=re.compile(r'\b(fully remote|remote[- ]first|work from anywhere|distributed team|anywhere in the (?:us|united states)|remote \(us|us[- ]remote|remote position|this is a remote)\b',re.I)

def dfw(loc):
    l=(loc or '').lower()
    if re.search(r'\b(dallas|fort worth|ft\.? worth|plano|irving|frisco|richardson|las colinas|mckinney|grapevine|addison|carrollton|dfw)\b',l): return True
    if re.search(r'\barlington\b',l) and ('tx' in l or 'texas' in l): return True
    return False
def sf(loc):
    l=(loc or '').lower()
    return bool(re.search(r'\bsan francisco\b|\bsf\b|bay area|south san francisco',l))
def is_us(b):
    b=b.lower()
    if any(w in b for w in['united states','remote - us','remote, us',' usa','u.s.','us-based','us based']):return True
    if any(st in b for st in US_STATES):return True
    if 'north america' in b and not re.search(r'canada|ireland|singapore|kingdom|india|germany|france|australia|europe',b):return True
    return False
def strip(t): return re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',html.unescape(t or '')))
def years(txt):
    for pat in [r'(\d{1,2})\s*\+?\s*(?:-|to|–|through)\s*(\d{1,2})\s*\+?\s*years',r'(\d{1,2})\s*\+\s*years',r'minimum of\s*(\d{1,2})\s*years',r'at least\s*(\d{1,2})\s*years',r'(\d{1,2})\s*years']:
        m=re.search(pat,txt,re.I)
        if m: return (int(m.group(1)), int(m.group(2)) if m.lastindex==2 else None)
    return (None,None)
def yok(mn,mx):  # eligible with 12 yrs -> stated minimum <=12 (or unspecified)
    return not (mn is not None and mn>12)
def yreq(mn,mx):
    if mn is None and mx is None:return 'n/s'
    if mx is None:return f"{mn}+"
    if mn is None:return f"≤{mx}"
    return f"{mn}-{mx}"
def remote_us(loc,rf,wt,jd):
    l=(loc or '').lower().strip(); b=l+' | '+jd[:800].lower()
    us=('united states' in b or ' usa' in b or 'u.s.' in b or 'us-based' in b or 'us based' in b or any(st in b for st in US_STATES) or any(c in l for c in US_CITIES) or 'anywhere in the us' in b)
    foreign=bool(FOREIGN.search(l))
    if 'remote canada' in l: return None
    if re.search(r'remote[\s,\-|]*(us|u\.s\.|usa|united states|north america)\b',l) and not re.search(r'remote[\s,\-|]*canada',l): return 'confident'
    hybrid=('hybrid' in l) or (wt=='hybrid') or bool(HYBRID_JD.search(jd))
    remote=bool(rf) or wt=='remote' or re.search(r'\bremote\b',l)
    if not remote: return None
    if foreign and not us: return None
    if REMOTE_JD.search(jd) and not hybrid and us: return 'confident'
    if 'remote' in l and not hybrid and us: return 'confident'
    if hybrid: return None
    if remote and us: return 'verify'
    return None

# ---- domain scoring: index on fintech / crypto / AI (health de-emphasized) ----
MKT_HINT={'coinbase':'crypto exchange web3','affirm':'fintech lending payments','brex':'fintech spend management',
 'mercury':'fintech banking','tala':'fintech lending','flex':'fintech payments platform','ramp':'fintech spend',
 'plaid':'fintech','stripe':'fintech payments','runlayer':'ai agents infrastructure','owner':'ai restaurant saas',
 'genlogs':'logistics data','motive':'logistics fleet ai','tanium':'cybersecurity','ispot.tv':'data analytics adtech',
 'instacart':'marketplace ecommerce','maven clinic':'healthcare','aledade':'healthcare value-based care',
 'rippling':'hr saas','continuumcloud':'healthcare saas','anaconda':'ai data science','arista networks':'networking'}
FINTECH=re.compile(r'crypto|web3|blockchain|defi|\bnft\b|stablecoin|digital asset|on-?chain|fintech|\bpayments?\b|banking|lending|neobank|financial services|insurtech|wealth|trading|brokerage|spend management|treasury|payroll|financial planning|\bfinance\b|\bfin-?tech\b',re.I)
AI=re.compile(r'\ba\.?i\.?\b|artificial intelligence|machine learning|\bml\b|\bllm\b|generative|agentic|\bagents?\b|foundation model|deep learning|neural|inference|copilot',re.I)
INFRA=re.compile(r'\bdata\b|infrastructure|\binfra\b|developer|dev ?tools|\bapi\b|database|observability|security|cyber|cloud|platform|enterprise software|\bsaas\b|analytics|automation|networking',re.I)
OTHER=re.compile(r'consumer|marketplace|e-?commerce|logistics|retail|health|clinical|biotech|medical|education|gaming|media|social|mobility|real estate|restaurant|hr\b',re.I)
def score(company,markets,title):
    blob=f"{company} {markets} {title}".lower()
    if FINTECH.search(blob): return 5,"fintech / crypto / payments — priority domain"
    if AI.search(blob):      return 4,"AI / ML — priority domain"
    if INFRA.search(blob):   return 3,"data / infra / dev-tools / security SaaS"
    if OTHER.search(blob):   return 2,"other vertical (consumer / health / logistics / etc.)"
    return 1,"no clear domain overlap"
PUBLIC={'instacart':'CART','figma':'FIG','oscar':'OSCR','coinbase':'COIN','affirm':'AFRM','datadog':'DDOG','cloudflare':'NET','confluent':'CFLT','asana':'ASAN','gitlab':'GTLB','samsara':'IOT','toast':'TOST','robinhood':'HOOD','sofi':'SOFI','doordash':'DASH','airbnb':'ABNB','snowflake':'SNOW','klaviyo':'KVYO','reddit':'RDDT','duolingo':'DUOL','dropbox':'DBX','twilio':'TWLO','block':'XYZ','okta':'OKTA','hashicorp':'HCP','mongodb':'MDB','unitedhealth':'UNH','genedx':'WGS','one medical':'ONEM','upstart':'UPST','arista networks':'ANET','wise':'WISE','pagaya':'PGY'}
def ownership(name):
    n=re.sub(r'\s+(inc|corp|co|technologies|labs|life|health|financial)\.?$','',name.lower()).strip()
    t=PUBLIC.get(name.lower()) or PUBLIC.get(n)
    return f"Public ({t})" if t else "Private"

rows={}; verify_rows=[]
def add(key,p,fund,tier='ok'):
    if tier=='verify': verify_rows.append({**p,'fund(s)':fund}); return
    if key not in rows: rows[key]=p; rows[key]['funds']=set()
    rows[key]['funds'].add(fund)

# ---------- Consider ----------
for f in glob.glob('raw_product/*.json'):
    if 'cj_' in f: continue
    fund=f.split('/')[-1][:-5]
    for j in json.load(open(f)).get('jobs',[]):
        t=j.get('title','')
        if not PROD.search(t) or PROD_EXCL.search(t): continue
        locblob=' '.join(str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []))+' '+' '.join(j.get('locations') or [])+' '+' '.join(str(r.get('value') if isinstance(r,dict) else r) for r in (j.get('regions') or []))
        remote=j.get('remote') and is_us(locblob)  # remote=True means remote-eligible (may also offer hybrid)
        d,s=dfw(locblob),sf(locblob)
        if not remote and not d and not s: continue
        mn,mx=j.get('minYearsExp'),j.get('maxYearsExp')
        if not yok(mn,mx): continue
        ts=(j.get('timeStamp') or '')[:10]
        try:
            if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
        except: pass
        sal=j.get('salary') or {}; comp=''
        if sal.get('minValue') and sal.get('maxValue') and sal['maxValue']>1000: comp=f"${int(sal['minValue']):,}–${int(sal['maxValue']):,}"
        mks=' '.join(str(m.get('value') if isinstance(m,dict) else m) for m in (j.get('markets') or []))
        sc,note=score(j.get('companyName',''),mks+' '+MKT_HINT.get((j.get('companyName') or '').lower(),''),t)
        scope='Remote (US)' if remote else ('DFW' if d else 'San Francisco')
        if not remote:
            city=next((str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []) if (dfw(str(x.get('value') if isinstance(x,dict) else x)) or sf(str(x.get('value') if isinstance(x,dict) else x)))),scope)
            scope=f"{scope}: {city}"+(" (hybrid)" if j.get('hybrid') else " (in-office)")
        key=(re.sub(r'[^a-z0-9]','',(j.get('companySlug') or j.get('companyName','')).lower()),re.sub(r'[^a-z0-9]','',t.lower()))
        add(key,{'fit_score':sc,'company':j.get('companyName',''),'ownership':ownership(j.get('companyName','')),'role_title':t,
            'seniority':', '.join(sorted(j.get('jobSeniorityIds') or [])) or 'unspecified','years_req':yreq(mn,mx),
            'remote_scope':scope,'posted_date':ts,'comp_range':comp,'domain_note':note,
            'ats_link':j.get('applyUrl') or j.get('url','')},FUND_LABEL.get(fund,fund))

# ---------- direct-ATS ----------
def title_of(ats,j): return j.get('title') or j.get('text') or j.get('name') or ''
for sfch in ['hc_all_scan.json','pc_scan.json','pc_new_scan.json','pc_new2_scan.json','recovered_scan.json']:
    if not glob.glob(sfch): continue
    for c in json.load(open(sfch)):
        if not c.get('ats'): continue
        ats=c['ats']
        for j in c['raw_jobs']:
            t=title_of(ats,j)
            if not PROD.search(t) or PROD_EXCL.search(t): continue
            if ats=='greenhouse':
                loc=(j.get('location') or {}).get('name',''); rf='remote' in loc.lower(); wt=''; jd=strip(j.get('content','')); ts=(j.get('updated_at') or '')[:10]; url=j.get('absolute_url',''); comp=''
            elif ats=='lever':
                cat=j.get('categories') or {}; loc=cat.get('location','') or ''; wt=(cat.get('workplaceType') or '').lower(); rf=wt=='remote'; jd=strip(j.get('descriptionPlain') or j.get('description','')); url=j.get('hostedUrl',''); comp=''
                ts=datetime.datetime.utcfromtimestamp(j['createdAt']/1000).date().isoformat() if j.get('createdAt') else ''
            elif ats=='ashby':
                loc=j.get('location','') or ''; rf=bool(j.get('isRemote')); wt=''; jd=strip(j.get('descriptionHtml') or j.get('descriptionPlain','')); url=j.get('jobUrl') or j.get('applyUrl',''); ts=(j.get('publishedAt') or '')[:10]
                cc=j.get('compensation') or {}; comp=(cc.get('compensationTierSummary') if isinstance(cc,dict) else '') or ''
            elif ats=='smartrecruiters':
                lo=j.get('location') or {}; loc=f"{lo.get('city','')}, {lo.get('region','')}, {lo.get('country','')}";
                if lo.get('remote'): loc='Remote, '+(lo.get('country') or 'US')
                rf=bool(lo.get('remote')); wt=''; jd=''; comp=''; ts=(j.get('releasedDate') or '')[:10]; url=f"https://jobs.smartrecruiters.com/{c['ats_token']}/{j.get('id','')}"
            elif ats=='workable':
                lo=j.get('location') or {}; loc=f"{lo.get('city','')}, {lo.get('country','')}"
                if lo.get('telecommuting') or j.get('remote'): loc='Remote, '+(lo.get('country') or 'US')
                rf=bool(lo.get('telecommuting') or j.get('remote')); wt=''; jd=''; comp=''; ts=(j.get('published_on') or '')[:10]; url=j.get('url') or ''
            elif ats=='rippling':
                loc=(j.get('workLocation') or {}).get('label','') or ''; rf='remote' in loc.lower(); wt=''; jd=''; comp=''; ts=''; url=j.get('url','')
            else: continue
            conf=remote_us(loc,rf,wt,jd); d,s=dfw(loc),sf(loc)
            if not conf and not d and not s: continue
            mn,mx=years(jd)
            if not yok(mn,mx): continue
            try:
                if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
            except: pass
            comp_name=c['name']; sc,note=score(comp_name,MKT_HINT.get(comp_name.lower(),''),t)
            if conf=='confident': scope='Remote (US)'
            elif d: scope=f"DFW: {loc}"
            elif s: scope=f"San Francisco: {loc}"
            elif conf=='verify': scope=f"Remote? verify (loc: {loc})"
            else: continue
            tier='verify' if scope.startswith('Remote? verify') else 'ok'
            fund=', '.join(c['funds']) if isinstance(c['funds'],list) else c['funds']
            key=(re.sub(r'[^a-z0-9]','',comp_name.lower()),re.sub(r'[^a-z0-9]','',t.lower()))
            add(key,{'fit_score':sc,'company':comp_name,'ownership':ownership(comp_name),'role_title':t,'seniority':'—',
                'years_req':yreq(mn,mx),'remote_scope':scope,'posted_date':ts,'comp_range':comp,'domain_note':note,'ats_link':url},fund,tier)

# ---- assemble + dedup ----
out=[]
for r in rows.values(): r['fund(s)']=', '.join(sorted(r.pop('funds'))); out.append(r)
merged={}
for r in out:
    k=(re.sub(r'[^a-z0-9]','',r['company'].lower()),re.sub(r'[^a-z0-9]','',r['role_title'].lower()))
    if k in merged:
        m=merged[k]; fs=sorted(set(x.strip() for x in (m['fund(s)']+', '+r['fund(s)']).split(',') if x.strip())); m['fund(s)']=', '.join(fs)
        if r['fit_score']>m['fit_score']: m['fit_score'],m['domain_note']=r['fit_score'],r['domain_note']
        if not m.get('comp_range') and r.get('comp_range'): m['comp_range']=r['comp_range']
        if m['remote_scope'].startswith(('DFW','San')) and r['remote_scope']=='Remote (US)': m['remote_scope']='Remote (US)'
    else: merged[k]=r
out=list(merged.values())
out.sort(key=lambda r:(r['fit_score'],r['posted_date'] or ''),reverse=True)
COLS=['fit_score','fund(s)','company','ownership','role_title','seniority','years_req','remote_scope','posted_date','comp_range','domain_note','ats_link']
for fn,data in [('product_leadership_roles.csv',out),('product_leadership_verify.csv',sorted(verify_rows,key=lambda r:(r['fit_score'],r['posted_date'] or ''),reverse=True))]:
    with open(fn,'w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=COLS); w.writeheader()
        for r in data: w.writerow({c:r.get(c,'') for c in COLS})
from collections import Counter
print(f"PRODUCT roles: {len(out)} confident + {len(verify_rows)} verify")
print("fit:",dict(sorted(Counter(r['fit_score'] for r in out).items(),reverse=True)))
for r in out: print(f"  {r['fit_score']} {r['role_title'][:44]:44} @ {r['company'][:20]:20} {r['ownership'][:13]:13} {r['years_req']:5} {r['remote_scope'][:26]:26} ({r['fund(s)'][:24]})")
