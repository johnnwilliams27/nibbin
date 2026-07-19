#!/usr/bin/env python3
"""Product/exec leadership scan: Director/Head/VP Product, CPO, COO, Founding PM.
Location: Remote-US OR Dallas-Fort Worth OR San Francisco. Eligible with 12 yrs (stated min <=12)."""
import json, glob, re, csv, datetime, html
TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FUND_LABEL={'a16z':'a16z','sequoia':'Sequoia','lightspeed':'Lightspeed','greylock':'Greylock',
 'bessemer':'Bessemer','kleiner':'Kleiner Perkins','battery':'Battery','gv':'GV','felicis':'Felicis'}

RECRUIT=re.compile(r'\b(recruit(?:er|ing|ment)?|talent acquisition|executive search|\bsourcer\b|(?:talent|technical|candidate|recruiting)\s+sourc\w+|talent partner|talent lead)\b',re.I)
# people / talent leadership
PEOPLE=re.compile(r'\b(chief people officer|chief human resources officer|\bchro\b|head of people|head of talent|head of recruiting|head of hr|(?:vp|svp|evp|vice president|director|head)[,\s]+(?:of\s+)?(?:people|talent|human resources|hr\b|recruiting)|people (?:operations )?lead|talent lead|head of people operations)\b',re.I)
CONTRACT=re.compile(r'\b(contract|contractor|fixed[- ]term|temporary|\btemp\b|fractional|freelance|seasonal)\b',re.I)
EXCL=re.compile(r'\b(intern(?:ship)?|apprentice|co-op|scheduler|work[- ]study|volunteer|student)\b',re.I)
def comp_max(s):
    best=None
    for num,suf in re.findall(r'\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?',s or ''):
        v=float(num.replace(',',''))
        if suf: v*=1000
        elif v<1000: v*=1000
        best=v if best is None else max(best,v)
    return best
def role_ok(title,ids=None,maxcomp=None):
    if not (RECRUIT.search(title) or PEOPLE.search(title)): return False
    if EXCL.search(title) or CONTRACT.search(title): return False
    return True
def austin(loc):
    l=(loc or '').lower()
    return bool(re.search(r'\baustin\b|round rock|cedar park|\batx\b',l))

US_STATES=set(['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','south carolina','north dakota','south dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','tennessee','texas','utah','vermont','virginia','west virginia','washington','wisconsin','wyoming'])
CITY_RE=re.compile(r'\b(san francisco|new york city|new york|nyc|seattle|austin|boston|chicago|denver|atlanta|dallas|los angeles|miami|tempe|oakland|mountain view|palo alto|redwood city|san mateo|sunnyvale|santa clara|bellevue|brooklyn|arlington|philadelphia|san jose|san diego|nashville|charlotte|columbus|remote us|\bsf\b|\bla\b|\bnyc\b|\bd\.?c\.?\b)\b',re.I)
FOREIGN=re.compile(r'\b(canada|toronto|vancouver|british columbia|ontario|montreal|london|england|dublin|ireland|paris|france|munich|germany|berlin|tel aviv|israel|singapore|seoul|korea|india|bangalore|bengaluru|\buk\b|united kingdom|emea|apac|latam|amsterdam|netherlands|sydney|australia|remote canada|mexico|brazil|tokyo|japan|colombia|bogota|argentina|chile|peru|philippines|indonesia|vietnam|thailand|nigeria|kenya|egypt|pakistan|bangladesh|ukraine|poland|warszawa|warsaw|romania|spain|madrid|barcelona|italy|portugal|lisbon|sweden|stockholm|norway|denmark|finland|switzerland|zurich|austria|belgium|greece|turkey|\buae\b|dubai|abu dhabi|saudi|qatar|hong kong|shanghai|beijing|shenzhen|taiwan|new zealand|south africa|masovian|voivodeship)\b',re.I)
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
US_ABBR=set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split())
def us_location(loc):
    l=loc or ''
    if re.search(r'\b(united states|usa|u\.s\.a?\.?|us[- ]based|remote us|\bus\b)\b',l,re.I): return True
    if STATES_RE.search(l): return True
    if re.search(r'\bdistrict of columbia\b|,\s*d\.?c\.?\b',l,re.I): return True
    if any(m in US_ABBR for m in re.findall(r',\s*([A-Z]{2})\b',l)): return True
    if CITY_RE.search(l): return True
    return False
STATES_RE=re.compile(r'\b('+'|'.join(sorted(US_STATES-{'columbia'},key=len,reverse=True))+r')\b',re.I)
def is_us(b):
    bl=(b or '').lower()
    if any(w in bl for w in['united states','remote - us','remote, us',' usa','u.s.','us-based','us based']):return True
    if STATES_RE.search(bl):return True
    if re.search(r'\bdistrict of columbia\b|washington,?\s*d\.?c\.?',bl):return True
    if 'north america' in bl and not FOREIGN.search(bl):return True
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
    us=('united states' in b or ' usa' in b or 'u.s.' in b or 'us-based' in b or 'us based' in b or any(st in b for st in US_STATES) or bool(CITY_RE.search(l)) or 'anywhere in the us' in b)
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

# ---------- Consider (HR function) ----------
for f in glob.glob('raw_hr/*.json'):
    if 'cj_' in f: continue
    fund=f.split('/')[-1][:-5]
    for j in json.load(open(f)).get('jobs',[]):
        t=j.get('title','')
        if not role_ok(t): continue
        locblob=' '.join(str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []))+' '+' '.join(j.get('locations') or [])+' '+' '.join(str(r.get('value') if isinstance(r,dict) else r) for r in (j.get('regions') or []))
        remote=j.get('remote') and is_us(locblob)
        d,a=dfw(locblob),austin(locblob)
        if not (remote or d or a): continue  # remote-US OR in-person Dallas/Austin
        sal=j.get('salary') or {}; comp=''; cnum=None
        if sal.get('minValue') and sal.get('maxValue') and sal['maxValue']>1000:
            comp=f"${int(sal['minValue']):,}–${int(sal['maxValue']):,}"; cnum=float(sal['maxValue'])
        ts=(j.get('timeStamp') or '')[:10]
        try:
            if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
        except: pass
        if remote: scope='Remote (US)'
        else:
            cities=[str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or [])]+(j.get('locations') or [])
            city=next((c for c in cities if dfw(c) or austin(c)),(cities[0] if cities else ''))
            tag='Dallas' if dfw(city) else ('Austin' if austin(city) else ('Dallas' if d else 'Austin'))
            scope=f"{tag}: {city}"+(" (hybrid)" if j.get('hybrid') else " (in-person)")
        key=(re.sub(r'[^a-z0-9]','',(j.get('companySlug') or j.get('companyName','')).lower()),re.sub(r'[^a-z0-9]','',t.lower()))
        add(key,{'company':j.get('companyName',''),'ownership':ownership(j.get('companyName','')),'role_title':t,
            'seniority':', '.join(sorted(j.get('jobSeniorityIds') or [])) or 'unspecified',
            'remote_scope':scope,'posted_date':ts,'comp_range':comp,'comp_num':cnum,
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
            if not role_ok(t): continue
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
            conf=remote_us(loc,rf,wt,jd); d,a=dfw(loc),austin(loc)
            if conf!='confident' and not d and not a: continue  # remote-US OR in-person Dallas/Austin
            cnum=comp_max(comp)
            try:
                if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
            except: pass
            comp_name=c['name']
            scope='Remote (US)' if conf=='confident' else (f"Dallas: {loc}" if d else f"Austin: {loc}")
            fund=', '.join(c['funds']) if isinstance(c['funds'],list) else c['funds']
            key=(re.sub(r'[^a-z0-9]','',comp_name.lower()),re.sub(r'[^a-z0-9]','',t.lower()))
            add(key,{'company':comp_name,'ownership':ownership(comp_name),'role_title':t,'seniority':'—',
                'remote_scope':scope,'posted_date':ts,'comp_range':comp,'comp_num':cnum,'ats_link':url},fund)

# ---- assemble + dedup ----
out=[]
for r in rows.values(): r['fund(s)']=', '.join(sorted(r.pop('funds'))); out.append(r)
merged={}
for r in out:
    k=(re.sub(r'[^a-z0-9]','',r['company'].lower()),re.sub(r'[^a-z0-9]','',r['role_title'].lower()))
    if k in merged:
        m=merged[k]; fs=sorted(set(x.strip() for x in (m['fund(s)']+', '+r['fund(s)']).split(',') if x.strip())); m['fund(s)']=', '.join(fs)
        if (r.get('comp_num') or 0)>(m.get('comp_num') or 0): m['comp_num'],m['comp_range']=r.get('comp_num'),r.get('comp_range')
        if m['remote_scope'].startswith(('Dallas','Austin')) and r['remote_scope']=='Remote (US)': m['remote_scope']='Remote (US)'
    else: merged[k]=r
out=list(merged.values())
# sort: highest paying first, then recency (no domain restriction)
out.sort(key=lambda r:((r.get('comp_num') or 0), r['posted_date'] or ''),reverse=True)
COLS=['comp_range','fund(s)','company','ownership','role_title','seniority','remote_scope','posted_date','ats_link']
with open('recruiter_roles.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=COLS); w.writeheader()
    for r in out: w.writerow({c:r.get(c,'') for c in COLS})
from collections import Counter
withcomp=[r for r in out if r.get('comp_num')]
loc=Counter('Remote' if r['remote_scope'].startswith('Remote') else ('Dallas' if 'Dallas' in r['remote_scope'] else 'Austin') for r in out)
print(f"RECRUITER/TALENT roles: {len(out)}  | with posted comp: {len(withcomp)} | locations: {dict(loc)}")
for r in out: print(f"  {(r['comp_range'] or '—'):22} {r['role_title'][:42]:42} @ {r['company'][:20]:20} {r['ownership'][:12]:12} {r['remote_scope'][:22]:22} ({r['fund(s)'][:20]})")
