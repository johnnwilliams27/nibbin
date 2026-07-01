#!/usr/bin/env python3
"""Assemble final fp_a_remote_roles.csv + Markdown from Phase A (Consider) + Phase B (healthcare ATS)."""
import json, glob, re, csv, datetime
from collections import defaultdict, Counter

TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FUND_LABEL={'a16z':'a16z','sequoia':'Sequoia','lightspeed':'Lightspeed','greylock':'Greylock',
 'bessemer':'Bessemer','kleiner':'Kleiner Perkins','battery':'Battery','gv':'GV','felicis':'Felicis'}
FIN=re.compile(r'\b(fp&a|fp and a|financial planning|strategic finance|corporate finance|finance & strategy|finance and strategy|financial analyst|finance analyst)\b',re.I)
LEAD=re.compile(r'\b(director|vp|vice president|head of|head,|chief|cfo|svp|evp)\b',re.I)
JUN=re.compile(r'\b(intern|internship|apprentice|co-op)\b',re.I)
def dfw(loc):
    l=(loc or '').lower()
    if re.search(r'\b(dallas|fort worth|ft\.? worth|plano|irving|frisco|richardson|las colinas|mckinney|grapevine|addison|carrollton|dfw)\b',l): return True
    if re.search(r'\barlington\b',l) and ('tx' in l or 'texas' in l): return True
    return False
US_STATES=set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming columbia".split())

PAYER_CO={'devoted health','clover health','oscar','oscar health','cohere health','alignment health','collective health','capital rx','rightway','turquoise health','sidecar health','sana benefits','angle health','gravie','welbehealth','wayspring','cotiviti','reveleer','abacus insights','abacusinsights','interwell health','oncohealth','ooda health','main street health','curana health','evergreen nephrology','rialtic'}
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
PUBLIC={'instacart':'CART','figma':'FIG','oscar':'OSCR','databricks':'','klaviyo':'KVYO',
        'toast':'TOST','samsara':'IOT','gitlab':'GTLB','confluent':'CFLT','hashicorp':'HCP',
        'reddit':'RDDT','duolingo':'DUOL','coinbase':'COIN','robinhood':'HOOD','sofi':'SOFI',
        'affirm':'AFRM','marqeta':'MQ','doordash':'DASH','airbnb':'ABNB','snowflake':'SNOW',
        'unitedhealth':'UNH','ge healthcare':'GEHC','genedx':'WGS','athenahealth':'','one medical':'ONEM'}
def is_public(name):
    n=re.sub(r'\s+(inc|corp|co|technologies|labs|health|life)\.?$','',name.lower()).strip()
    return name.lower() in PUBLIC or n in PUBLIC
def ownership(name):
    n=re.sub(r'\s+(inc|corp|co|technologies|labs|health|life)\.?$','',name.lower()).strip()
    tick=PUBLIC.get(name.lower()) or PUBLIC.get(n)
    if tick is not None: return f"Public ({tick})" if tick else "Public"
    return "Private"

rows={}
def add(key,payload,fund):
    if key not in rows: rows[key]=payload; rows[key]['funds']=set()
    rows[key]['funds'].add(fund)

# ---------- Phase A: Consider ----------
def years_ok(mn,mx):
    # candidate has 8 yrs: include if 8 yrs qualifies, i.e. stated minimum <= 8
    if mn is not None and mn>8:return False
    return True
for f in glob.glob('raw/*.json'):
    fund=f.split('/')[-1][:-5]; d=json.load(open(f))
    for j in d.get('jobs',[]):
        t=j.get('title','')
        if not FIN.search(t) or JUN.search(t):continue
        is_lead=bool(LEAD.search(t))  # Director/VP/Head/Chief -> only if a stated min <=8 yrs
        locblob=' '.join(str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []))+' '+' '.join(j.get('locations') or [])+' '+' '.join(str(r.get('value') if isinstance(r,dict) else r) for r in (j.get('regions') or []))
        remote_us = j.get('remote') and not j.get('hybrid') and is_us(locblob)
        is_dfw = dfw(locblob)
        if not remote_us and not is_dfw: continue
        mn,mx=j.get('minYearsExp'),j.get('maxYearsExp')
        if not years_ok(mn,mx):continue
        if is_lead and mn is None: continue  # higher-level role needs an explicit min that 8 yrs meets
        ids=set(j.get('jobSeniorityIds') or [])
        if ids and ids<={'intern'}:continue
        ts=(j.get('timeStamp') or '')[:10]
        try:
            if ts and datetime.date.fromisoformat(ts)<CUTOFF:continue
        except:pass
        sal=j.get('salary') or {}; comp=''
        if sal.get('minValue') and sal.get('maxValue') and sal['maxValue']>1000:
            comp=f"${int(sal['minValue']):,}–${int(sal['maxValue']):,}"
        mks=' '.join(str(m.get('value') if isinstance(m,dict) else m) for m in (j.get('markets') or []))
        sc,note=score(j.get('companyName',''),mks,t)
        if remote_us: scope='Remote (US)'
        else:
            dfwcity=next((str(x.get('value') if isinstance(x,dict) else x) for x in (j.get('normalizedLocations') or []) if dfw(str(x.get('value') if isinstance(x,dict) else x))),'DFW')
            scope=f"DFW: {dfwcity}"+(" (hybrid)" if j.get('hybrid') else " (in-office)")
        key=(re.sub(r'[^a-z0-9]','',(j.get('companySlug') or j.get('companyName','')).lower()),re.sub(r'[^a-z0-9]','',t.lower()))
        add(key,{'fit_score':sc,'company':j.get('companyName',''),'role_title':t,'ownership':ownership(j.get('companyName','')),
            'seniority':', '.join(sorted(ids)) or 'unspecified','years_req':yreq(mn,mx),
            'remote_scope':scope,'posted_date':ts,'comp_range':comp,'domain_note':note,
            'ats_link':j.get('applyUrl') or j.get('url','')}, FUND_LABEL.get(fund,fund))

# ---------- Phase B+C: direct-ATS confident roles ----------
MKT_HINT={'ambience healthcare':'healthcare clinical','stripe':'fintech payments','plaid':'fintech',
          'perplexity':'ai saas','assort health':'healthcare','solace health':'healthcare',
          'affirm':'fintech payments lending','upstart':'fintech lending','farther':'fintech wealth',
          'collibra':'data governance saas','salsify':'ecommerce saas','island':'security saas',
          'precision medicine group':'healthcare pharma clinical services','imagine pediatrics':'healthcare pediatric care',
          'lyra health':'healthcare mental health','datadog':'saas observability','cloudflare':'saas security',
          'mercury':'fintech banking','coinbase':'fintech crypto payments','twilio':'saas communications',
          'dropbox':'saas storage','anaconda (fka continuum analytics)':'data science saas','anaconda':'data science saas',
          'descript':'saas media','kaseya':'saas it management','smartsheet':'saas productivity','arista networks':'saas networking hardware',
          'bitwarden':'saas security','collibra':'data governance saas','salsify':'ecommerce saas'}
verify_rows=[]
for r in json.load(open('direct_ats_roles.json')):
    t=r['role_title']; comp=r['company']
    sc,note=score(comp, MKT_HINT.get(comp.lower(),''), t)
    fund=', '.join(r['funds']) if isinstance(r['funds'],list) else r['funds']
    conf=r['remote_conf']
    scope={'confident':'Remote (US)','dfw':f"DFW: {r['location']}"}.get(conf, f"Remote? verify (loc: {r['location']})")
    payload={'fit_score':sc,'company':comp,'role_title':t,'ownership':ownership(comp),
        'seniority':'—','years_req':r['years_req'],
        'remote_scope':scope,
        'posted_date':r['posted_date'],'comp_range':r.get('comp_range',''),'domain_note':note,
        'ats_link':r['ats_link'],'funds':fund}
    if conf=='verify':
        verify_rows.append(payload); continue
    key=(re.sub(r'[^a-z0-9]','',comp.lower()),re.sub(r'[^a-z0-9]','',t.lower()))
    add(key,payload,fund)

out=[]
for r in rows.values():
    r['fund(s)']=', '.join(sorted(r.pop('funds'))); out.append(r)
# final cross-pipeline dedup: same company+role from Consider AND direct-ATS -> one row (max fit, union funds)
merged={}
for r in out:
    k=(re.sub(r'[^a-z0-9]','',r['company'].lower()), re.sub(r'[^a-z0-9]','',r['role_title'].lower()))
    if k in merged:
        m=merged[k]
        fs=sorted(set(x.strip() for x in (m['fund(s)']+', '+r['fund(s)']).split(',') if x.strip()))
        m['fund(s)']=', '.join(fs)
        if r['fit_score']>m['fit_score']: m['fit_score'],m['domain_note']=r['fit_score'],r['domain_note']
        if not m.get('comp_range') and r.get('comp_range'): m['comp_range']=r['comp_range']
        if m['remote_scope'].startswith('DFW') and r['remote_scope']=='Remote (US)': m['remote_scope']='Remote (US)'
    else:
        merged[k]=r
out=list(merged.values())
out.sort(key=lambda r:(r['fit_score'], r['posted_date'] or ''), reverse=True)

COLS=['fit_score','fund(s)','company','ownership','role_title','seniority','years_req','remote_scope','posted_date','comp_range','domain_note','ats_link']
with open('fp_a_remote_roles.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=COLS);w.writeheader()
    for r in out:w.writerow({c:r.get(c,'') for c in COLS})

# ---------- Markdown ----------
def md_table(rows):
    h='| '+' | '.join(['fit','fund(s)','company','ownership','role','seniority','yrs','location','posted','comp','domain','link'])+' |\n'
    h+='|'+'|'.join(['---']*12)+'|\n'
    for r in rows:
        link=f"[apply]({r['ats_link']})" if r['ats_link'] else ''
        h+='| '+' | '.join(str(x) for x in [r['fit_score'],r['fund(s)'],r['company'],r.get('ownership','Private'),r['role_title'],r['seniority'],r['years_req'],r['remote_scope'],r['posted_date'],r['comp_range'] or '—',r['domain_note'],link])+' |\n'
    return h
fitc=Counter(r['fit_score'] for r in out)
# ---- totals ----
consider_cos=set()
consider_fin_jobs=0
for f in glob.glob('raw/*.json'):
    for j in json.load(open(f)).get('jobs',[]):
        consider_cos.add(j.get('companySlug') or j.get('companyName'))
        consider_fin_jobs+=1
fallback=[]
for sf in ['hc_all_scan.json','pc_scan.json','pc_new_scan.json','pc_new2_scan.json','recovered_scan.json']:
    if glob.glob(sf): fallback+=json.load(open(sf))
hc=fallback  # name kept for downstream
hc_resolved=[c for c in fallback if c.get('ats')]
hc_errored=[c for c in fallback if not c.get('ats')]
pc=[]; pc_resolved=[]; pc_errored=[]
enumerated=len(consider_cos)+len(fallback)
scanned=len(consider_cos)+len(hc_resolved)
errored_direct=len(hc_errored)
with open('fp_a_remote_roles.md','w') as fh:
    fh.write("# FP&A / Strategic Finance / Financial-Analyst Roles — VC Portfolio Sweep (Remote-US + Dallas–Fort Worth)\n\n")
    fh.write(f"_Generated {TODAY.isoformat()} • FP&A/Strategic-Finance/Financial-Analyst • roles a candidate with **8 yrs experience qualifies for (stated min ≤8 yrs)** • **Remote-US OR Dallas–Fort Worth metro (in-office/hybrid OK)** • posted ≤ 60 days (since {CUTOFF.isoformat()}) • public + private companies • Director/VP/Head titles included when a stated min ≤8 yrs_\n\n")
    fh.write(f"**{len(out)} matching roles** — fit mix: "+', '.join(f"{k}★×{fitc[k]}" for k in sorted(fitc,reverse=True))+"\n\n")
    fh.write("Fit key: **5**=payer/PBM/claims core · **4**=healthcare/health-tech · **3**=fintech/payments/insurtech · **2**=other SaaS · **1**=no overlap\n\n")
    fh.write(md_table(out))
    for vr in verify_rows: vr['fund(s)']=vr.get('funds','')
    if verify_rows:
        verify_rows.sort(key=lambda r:(r['fit_score'],r['posted_date'] or ''),reverse=True)
        fh.write("\n## Remote-eligibility UNCONFIRMED (verify before applying)\n\n")
        fh.write("These matched function/seniority/recency and the ATS flags them remote-eligible, but the posting lists an office (SF/NYC HQ) and the JD doesn't explicitly confirm remote — several such companies (Ramp, OpenAI) are actually hybrid/in-office. Confirm the work model before pursuing.\n\n")
        fh.write(md_table(verify_rows))
    fh.write("\n## Totals\n\n")
    fh.write(f"- **Funds swept:** 9 Consider boards (full API) + 17 funds via portfolio→direct-ATS fallback (Oak HC/FT, .406, Venrock, General Catalyst, Accel [784 cos via Sanity API], Insight [800 via WP API], Redpoint [285 via Sanity], Spark, Khosla, 8VC, Menlo, Craft, Coatue, Founders Fund, Index, IVP, NEA)\n")
    fh.write(f"- **Companies enumerated:** ~{enumerated:,} (Consider: {len(consider_cos):,} distinct w/ finance postings across {consider_fin_jobs:,} finance roles; portfolio-fallback: {len(hc)+len(pc):,})\n")
    fh.write(f"- **Private companies scanned (ATS reached):** ~{scanned:,} (direct-ATS resolved: {len(hc_resolved)+len(pc_resolved)} of {len(hc)+len(pc)} fallback companies)\n")
    fh.write(f"- **Matching roles found:** {len(out)} confident + {len(verify_rows)} unconfirmed-remote\n")
    pubn=sum(1 for r in out if str(r.get('ownership','')).startswith('Public'))
    dfwn=sum(1 for r in out if str(r.get('remote_scope','')).startswith('DFW'))
    fh.write(f"- **Public companies included:** {pubn} of {len(out)} roles are at public companies (now in-scope). **DFW-metro in-office/hybrid roles:** {dfwn}.\n")
    fh.write(f"- **Companies that errored / no public ATS:** {errored_direct} fallback cos after probing 7 ATS backends (Greenhouse/Lever/Ashby/SmartRecruiters/Workable/Rippling) — remainder on Workday (per-tenant, no public API) or custom/no public board\n\n")
    fh.write("## Coverage & method\n\n")
    fh.write("**Fully swept (Consider-backed boards, JSON API):** a16z, Sequoia, Lightspeed, Greylock, Bessemer, Kleiner Perkins, Battery, GV, Felicis. "
             "One `POST /api-boards/search-jobs` per board with `jobFunctions:[\"Finance\"]` returns every portfolio finance posting pre-structured. Filtered client-side to FP&A/Strategic-Finance/Corporate-Finance/**Financial-Analyst** titles, **Remote-US OR Dallas–Fort Worth metro** (in-office/hybrid OK for DFW), **stated min ≤8 yrs (8 yrs of experience qualifies)**, ≤60 days. Public and private companies both included; Director/VP/Head titles included only when a stated minimum is ≤8 yrs.\n\n")
    fh.write("**Portfolio → direct-ATS fallback (17 funds on Getro or with no Consider board):** companies enumerated from each fund's public portfolio — via their CMS/APIs where the page was JS-locked (Accel & Redpoint via Sanity GROQ, Insight via WordPress `sfcompany`), then each company probed across **7 ATS backends** (Greenhouse/Lever/Ashby/SmartRecruiters/Workable/Rippling) and JDs parsed for remote policy + years. "
             "Net-new yield is low and expected: these portfolios overlap heavily with the Consider funds (hot cos like Ramp/Anrok/Stripe recur and are deduped), and most 'strategic finance' roles at these hot startups are SF/NYC **in-office or hybrid**; the genuinely-remote ones are largely at **public** companies (Affirm, Upstart, Datadog) excluded by Step 2. The payer-core names (Devoted, Cotiviti, welbehealth, abacusinsights, Reveleer, Aledade) had no qualifying open remote FP&A role in-window.\n\n")
    fh.write("**Token-mismatch recovery pass:** all ~1,544 companies that didn't resolve by name were re-checked by scraping their careers page for the real embedded ATS token, then re-probed — recovering 38 companies with live boards. Net-new qualifying roles: **0**. The only two FP&A roles found were Nourish (*Strategic Finance Lead* — in-office NYC) and Transcend (*Director of FP&A* — remote but **10+ yrs**, exceeds the 8-yr bar). Confirms the diagnostic: recoverable token-misses don't hide qualifying remote/DFW roles.\n\n")
    fh.write("**Why ~{} companies don't resolve (diagnosed on a random sample):** ~44% have a custom / JS-embedded / bot-blocked careers page (no public JSON API); ~40% are exited/acquired/defunct portfolio companies that aren't hiring (VC portfolios list decades of them — Bay Networks, HomeAway, Castlight) or my domain guess missed a non-.com domain; ~13% are on a supported ATS under a non-guessable token (e.g. Nourish→Greenhouse); the rest run on Workday/iCIMS/ADP/Paylocity (no simple public API). Net: non-resolution is dominated by non-hiring/exited companies, not by fixable token misses.\n\n".format(errored_direct))
    fh.write("**Still not reached:** Thrive, Conviction, Radical, Benchmark, Flare Capital (no machine-readable public portfolio list — fully JS-locked or none published), plus Getro job boards themselves (block non-browser access; egress proxy drops headless-Chrome TLS). Coatue is partial (~40 of its portfolio; lazy-loaded grid).\n\n")
    fh.write("**Borderline (excluded from main list):** Redox — *Principal FP&A (SaaS Healthcare)*, remote fit-4, but >60 days & Principal-level. Heartbeat Health — *Senior Financial Analyst*, remote health, generic-analyst title.\n")
print(f"FINAL: {len(out)} roles written to fp_a_remote_roles.csv / .md")
print("fit distribution:",dict(sorted(fitc.items(),reverse=True)))
for r in out:print(f"  [{r['fit_score']}] {r['role_title']} @ {r['company']} ({r['fund(s)']}) {r['posted_date']}")
