#!/usr/bin/env python3
"""Assemble final fp_a_remote_roles.csv + Markdown from Phase A (Consider) + Phase B (healthcare ATS)."""
import json, glob, re, csv, datetime
from collections import defaultdict, Counter

TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FUND_LABEL={'a16z':'a16z','sequoia':'Sequoia','lightspeed':'Lightspeed','greylock':'Greylock',
 'bessemer':'Bessemer','kleiner':'Kleiner Perkins','battery':'Battery','gv':'GV','felicis':'Felicis'}
FIN=re.compile(r'\b(fp&a|fp and a|financial planning|strategic finance|corporate finance|finance & strategy|finance and strategy)\b',re.I)
LEAD=re.compile(r'\b(director|vp|vice president|head of|head,|chief|cfo|svp|evp)\b',re.I)
JUN=re.compile(r'\b(intern|internship|apprentice|co-op|analyst i\b)\b',re.I)
US_STATES=set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming columbia".split())

PAYER_CO={'devoted health','clover health','oscar health','cohere health','alignment health','collective health','capital rx','rightway','turquoise health','sidecar health','sana benefits','angle health','gravie','welbehealth','wayspring','cotiviti','reveleer','abacus insights','abacusinsights','interwell health','oncohealth','ooda health','main street health','curana health','evergreen nephrology','rialtic'}
PAYER_KW=re.compile(r'\b(payer|pbm|pharmacy benefit|prior auth|claims|health plan|health insurance|medicare|medicaid|revenue cycle|\brcm\b|care navigation|utilization management|actuar|value-based care)\b',re.I)
HEALTH_KW=re.compile(r'\bhealth|clinical|patient|pharma|biotech|medical|care\b',re.I)
FIN_KW=re.compile(r'\bfintech|payments|insurtech|banking|lending|financial services|insurance\b',re.I)

def is_us(locblob):
    b=locblob.lower()
    if any(w in b for w in['united states','remote - us','remote, us',' usa','u.s.','us-based','us based']):return True
    if any(st in b for st in US_STATES):return True
    if 'north america' in b and not re.search(r'canada|ireland|singapore|kingdom|india|germany|france|australia|europe',b):return True
    return False

def score(company,markets,title,extra=''):
    blob=f"{company} {markets} {title} {extra}".lower()
    if company.lower() in PAYER_CO or PAYER_KW.search(blob):return 5,"payer / health-insurance economics is the core product"
    if HEALTH_KW.search(blob):return 4,"healthcare / health-tech (non-payer)"
    if FIN_KW.search(blob):return 3,"fintech / payments / insurtech (adjacent domain)"
    if re.search(r'\bsaas|enterprise|\bai\b|consumer|productivity|analytics|security|software',blob):return 2,"vertical/horizontal SaaS — no domain overlap"
    return 1,"no domain overlap"

def yreq(mn,mx):
    if mn is None and mx is None:return 'n/s'
    if mx is None:return f"{mn}+"
    if mn is None:return f"≤{mx}"
    return f"{mn}-{mx}"

# publicly-traded companies (have a ticker) — excluded per Step 2
PUBLIC={'instacart':'CART (Nasdaq)','figma':'FIG (NYSE)','databricks':'','klaviyo':'KVYO',
        'toast':'TOST','samsara':'IOT','gitlab':'GTLB','confluent':'CFLT','hashicorp':'HCP',
        'reddit':'RDDT','duolingo':'DUOL','coinbase':'COIN','robinhood':'HOOD','sofi':'SOFI',
        'affirm':'AFRM','marqeta':'MQ','doordash':'DASH','airbnb':'ABNB','snowflake':'SNOW',
        'unitedhealth':'UNH','ge healthcare':'GEHC','genedx':'WGS','athenahealth':'','one medical':'ONEM'}
def is_public(name):
    n=re.sub(r'\s+(inc|corp|co|technologies|labs|health|life)\.?$','',name.lower()).strip()
    return name.lower() in PUBLIC or n in PUBLIC

rows={}; dropped_public=set()
def add(key,payload,fund):
    if is_public(payload['company']): dropped_public.add(payload['company']); return
    if key not in rows: rows[key]=payload; rows[key]['funds']=set()
    rows[key]['funds'].add(fund)

# ---------- Phase A: Consider ----------
def years_ok(mn,mx):
    if mn is not None and mn>8:return False
    if mx is not None and mx<5:return False
    if mn is not None and mn<3:return False
    return True
for f in glob.glob('raw/*.json'):
    fund=f.split('/')[-1][:-5]; d=json.load(open(f))
    for j in d.get('jobs',[]):
        t=j.get('title','')
        if not FIN.search(t) or LEAD.search(t) or JUN.search(t):continue
        if not(j.get('remote') and not j.get('hybrid')):continue
        locblob=' '.join(str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []))+' '+' '.join(j.get('locations') or [])+' '+' '.join(str(r.get('value') if isinstance(r,dict) else r) for r in (j.get('regions') or []))
        if not is_us(locblob):continue
        mn,mx=j.get('minYearsExp'),j.get('maxYearsExp')
        if not years_ok(mn,mx):continue
        ids=set(j.get('jobSeniorityIds') or [])
        if ids and ids<={'junior','intern'}:continue
        ts=(j.get('timeStamp') or '')[:10]
        try:
            if ts and datetime.date.fromisoformat(ts)<CUTOFF:continue
        except:pass
        sal=j.get('salary') or {}; comp=''
        if sal.get('minValue') and sal.get('maxValue') and sal['maxValue']>1000:
            comp=f"${int(sal['minValue']):,}–${int(sal['maxValue']):,}"
        mks=' '.join(str(m.get('value') if isinstance(m,dict) else m) for m in (j.get('markets') or []))
        sc,note=score(j.get('companyName',''),mks,t)
        key=(re.sub(r'[^a-z0-9]','',(j.get('companySlug') or j.get('companyName','')).lower()),re.sub(r'[^a-z0-9]','',t.lower()))
        add(key,{'fit_score':sc,'company':j.get('companyName',''),'role_title':t,
            'seniority':', '.join(sorted(ids)) or 'unspecified','years_req':yreq(mn,mx),
            'remote_scope':'Remote (US)','posted_date':ts,'comp_range':comp,'domain_note':note,
            'ats_link':j.get('applyUrl') or j.get('url','')}, FUND_LABEL.get(fund,fund))

# ---------- Phase B: healthcare ATS ----------
for r in json.load(open('hc_roles.json')):
    t=r['role_title']
    sc,note=score(r['company'],'healthcare',t)
    key=(re.sub(r'[^a-z0-9]','',r['company'].lower()),re.sub(r'[^a-z0-9]','',t.lower()))
    fund=', '.join(r['funds']) if isinstance(r['funds'],list) else r['funds']
    add(key,{'fit_score':sc,'company':r['company'],'role_title':t,'seniority':'lead',
        'years_req':r['years_req'],'remote_scope':'Remote (US)','posted_date':r['posted_date'],
        'comp_range':r.get('comp_range',''),'domain_note':note,'ats_link':r['ats_link']}, fund)

out=[]
for r in rows.values():
    r['fund(s)']=', '.join(sorted(r.pop('funds'))); out.append(r)
out.sort(key=lambda r:(r['fit_score'], r['posted_date'] or ''), reverse=True)

COLS=['fit_score','fund(s)','company','role_title','seniority','years_req','remote_scope','posted_date','comp_range','domain_note','ats_link']
with open('fp_a_remote_roles.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=COLS);w.writeheader()
    for r in out:w.writerow({c:r.get(c,'') for c in COLS})

# ---------- Markdown ----------
def md_table(rows):
    h='| '+' | '.join(['fit','fund(s)','company','role','seniority','yrs','remote','posted','comp','domain','link'])+' |\n'
    h+='|'+'|'.join(['---']*11)+'|\n'
    for r in rows:
        link=f"[apply]({r['ats_link']})" if r['ats_link'] else ''
        h+='| '+' | '.join(str(x) for x in [r['fit_score'],r['fund(s)'],r['company'],r['role_title'],r['seniority'],r['years_req'],r['remote_scope'],r['posted_date'],r['comp_range'] or '—',r['domain_note'],link])+' |\n'
    return h
fitc=Counter(r['fit_score'] for r in out)
# ---- totals ----
consider_cos=set()
consider_fin_jobs=0
for f in glob.glob('raw/*.json'):
    for j in json.load(open(f)).get('jobs',[]):
        consider_cos.add(j.get('companySlug') or j.get('companyName'))
        consider_fin_jobs+=1
hc=json.load(open('hc_all_scan.json'))
hc_resolved=[c for c in hc if c['ats']]
hc_errored=[c for c in hc if not c['ats']]
enumerated=len(consider_cos)+len(hc)
scanned=len(consider_cos)+len(hc_resolved)
with open('fp_a_remote_roles.md','w') as fh:
    fh.write("# Remote Mid-Senior FP&A / Strategic Finance Roles — VC Portfolio Sweep\n\n")
    fh.write(f"_Generated {TODAY.isoformat()} • remote US-eligible • ~5–8 yrs (Analyst→Sr Manager) • posted ≤ 60 days (since {CUTOFF.isoformat()}) • public companies excluded_\n\n")
    fh.write(f"**{len(out)} matching roles** — fit mix: "+', '.join(f"{k}★×{fitc[k]}" for k in sorted(fitc,reverse=True))+"\n\n")
    fh.write("Fit key: **5**=payer/PBM/claims core · **4**=healthcare/health-tech · **3**=fintech/payments/insurtech · **2**=other SaaS · **1**=no overlap\n\n")
    fh.write(md_table(out))
    fh.write("\n## Totals\n\n")
    fh.write(f"- **Companies enumerated:** ~{enumerated:,} (Consider boards: {len(consider_cos):,} distinct w/ finance postings across {consider_fin_jobs:,} finance roles; healthcare portfolios: {len(hc)})\n")
    fh.write(f"- **Private companies scanned:** ~{scanned:,} ({len(hc_resolved)} healthcare cos with a resolvable public ATS)\n")
    fh.write(f"- **Matching roles found:** {len(out)}\n")
    fh.write(f"- **Public companies dropped (Step 2):** {', '.join(sorted(dropped_public)) or 'none'}\n")
    fh.write(f"- **Companies that errored / no public ATS:** {len(hc_errored)} healthcare cos (token unresolved — likely Rippling/Workable/BambooHR/custom, or no open board)\n\n")
    fh.write("## Coverage & method\n\n")
    fh.write("**Fully swept (Consider-backed boards, JSON API):** a16z, Sequoia, Lightspeed, Greylock, Bessemer, Kleiner Perkins, Battery, GV, Felicis. "
             "One `POST /api-boards/search-jobs` per board with `jobFunctions:[\"Finance\"]` returns every portfolio finance posting pre-structured (title, company, remote/hybrid, salary, seniority, years, posted date, ATS apply URL). Filtered client-side to FP&A/Strategic/Corporate-Finance titles, remote-US, ~5–8 yrs, ≤60 days.\n\n")
    fh.write("**Healthcare-priority funds (fallback: portfolio page → direct ATS):** Oak HC/FT (108 cos) and .406 Ventures (51 cos) enumerated from their public portfolio pages, then each company's Greenhouse/Lever/Ashby JSON board probed directly (64/159 resolved). "
             "Yield is low because these are mostly small health startups with no open *remote* FP&A role in-window; the payer-core names (Devoted, Cotiviti, welbehealth, abacusinsights, Reveleer) had no qualifying opening.\n\n")
    fh.write("**Not directly enumerated (documented gap):** Getro-backed boards — General Catalyst, Accel, Insight, 8VC, Khosla, Craft, Thrive, Coatue, Menlo, plus healthcare Venrock & Flare — actively block non-browser access (their board returns a stub directing to a paid API), and this environment's egress proxy drops headless-Chrome TLS, so JS rendering wasn't available. These portfolios overlap heavily with the Consider funds above (hot companies like Ramp/Anrok recur across portfolios and are already captured), so net-new roles are limited. Funds whose board URL didn't resolve: Redpoint, Benchmark, Index, IVP, NEA, Spark, Founders Fund, Conviction, Radical.\n\n")
    fh.write("**Borderline roles (not in main list):** Redox — *Principal FP&A (SaaS Healthcare)*, remote, health-data fit-4, but posted >60 days & Principal-level (likely >8 yrs). Heartbeat Health — *Senior Financial Analyst*, remote health, but generic-analyst title (couldn't confirm FP&A scope).\n")
print(f"FINAL: {len(out)} roles written to fp_a_remote_roles.csv / .md")
print("fit distribution:",dict(sorted(fitc.items(),reverse=True)))
for r in out:print(f"  [{r['fit_score']}] {r['role_title']} @ {r['company']} ({r['fund(s)']}) {r['posted_date']}")
