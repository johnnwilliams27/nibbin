#!/usr/bin/env python3
"""Robust FP&A remote-US extractor for direct-ATS scans (greenhouse/lever/ashby)."""
import json, re, datetime, html, sys
TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FIN=re.compile(r'\b(fp&a|financial planning|strategic finance|corporate finance|finance & strategy|finance and strategy)\b',re.I)
LEAD=re.compile(r'\b(director|vp|vice president|head of|head,|chief|cfo|svp|evp|senior director)\b',re.I)
JUN=re.compile(r'\b(intern|internship|apprentice|co-op)\b',re.I)
US_STATES=set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming columbia".split())
US_CITIES=set("san francisco new york nyc sf seattle austin boston chicago denver atlanta dallas los angeles la miami tempe oakland mountain view palo alto redwood san mateo washington dc arlington philadelphia".split())
FOREIGN=re.compile(r'\b(canada|toronto|vancouver|london|dublin|ireland|paris|france|munich|germany|berlin|tel aviv|israel|singapore|seoul|korea|india|bangalore|london|uk|united kingdom|emea|apac|latam|amsterdam|netherlands|sydney|australia|remote canada|remote - canada|remote emea|mexico city|brazil|tokyo|japan)\b',re.I)

def strip(t): return re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',html.unescape(t or '')))
def years(txt):
    for pat in [r'(\d{1,2})\s*\+?\s*(?:-|to|–|through)\s*(\d{1,2})\s*\+?\s*years',r'(\d{1,2})\s*\+\s*years',r'minimum of\s*(\d{1,2})\s*years',r'at least\s*(\d{1,2})\s*years',r'(\d{1,2})\s*years']:
        m=re.search(pat,txt,re.I)
        if m: return (int(m.group(1)), int(m.group(2)) if m.lastindex==2 else None)
    return (None,None)
def yok(mn,mx):
    if mn is not None and mn>8: return False
    if mx is not None and mx<5: return False
    return True
def yreq(mn,mx):
    if mn is None and mx is None:return 'n/s'
    if mx is None:return f"{mn}+"
    if mn is None:return f"≤{mx}"
    return f"{mn}-{mx}"

PUBLIC={'affirm','upstart','datadog','cloudflare','confluent','asana','figma','chime','coinbase','robinhood','gitlab','samsara','toast','instacart','oscar','oscar health','guardant','guardant health','sofi','doordash','airbnb','klaviyo','bumble','carta','block','okta','ringcentral','nutanix','blackberry','duolingo','reddit','snowflake','mongodb','cloudera','pure storage','ziprecruiter','lyft','uber','netflix','dropbox','pagaya','wise','squarespace','trustpilot','adyen','revolut','deliveroo',' altruist','10x genomics','illumina','intel','apple','gilead','tempus','cloudflare','coursera','patreon'}
HYBRID_JD=re.compile(r'hybrid work model|days? (?:a|per) week in|in[- ]office|this role is based in|based in our|based out of our|relocation assistance|onsite|on-site',re.I)
REMOTE_JD=re.compile(r'\b(fully remote|remote[- ]first|work from anywhere|distributed team|anywhere in the (?:us|united states)|remote \(us|us[- ]remote|remote position|this is a remote)\b',re.I)

def is_public(name):
    n=re.sub(r'\s+(inc|corp|co|technologies|labs|life|health|financial)\.?$','',name.lower()).strip()
    return name.lower() in PUBLIC or n in PUBLIC

def remote_us(loc, remote_flag, wtype, jd):
    """Return 'confident' | 'verify' | None."""
    l=(loc or '').lower().strip()
    b=l+' | '+jd[:800].lower()
    us = ('united states' in b or ' usa' in b or 'u.s.' in b or 'us-based' in b or 'us based' in b
          or any(st in b for st in US_STATES) or any(c in l for c in US_CITIES) or 'anywhere in the us' in b)
    foreign = bool(FOREIGN.search(l))
    if 'remote canada' in l: return None
    # explicit remote-US in LOCATION string → confident
    if re.search(r'remote[\s,\-|]*(us|u\.s\.|usa|united states|north america)\b',l) and not re.search(r'remote[\s,\-|]*canada',l):
        return 'confident'
    hybrid = ('hybrid' in l) or (wtype=='hybrid') or bool(HYBRID_JD.search(jd))
    remote = bool(remote_flag) or wtype=='remote' or re.search(r'\bremote\b',l)
    if not remote: return None
    if foreign and not us: return None
    # JD explicitly confirms remote & no hard hybrid → confident
    if REMOTE_JD.search(jd) and not hybrid and us: return 'confident'
    if 'remote' in l and not hybrid and us: return 'confident'
    if hybrid: return None
    # remote flag only (e.g. ashby isRemote), US office, no confirmation → verify
    if remote and us: return 'verify'
    return None

def extract(scan_path):
    out=[]
    for c in json.load(open(scan_path)):
        if not c.get('ats'): continue
        if is_public(c['name']): continue
        ats=c['ats']
        if ats not in ('greenhouse','lever','ashby'): continue  # SR/Workable/Rippling verified separately (0 qualifying)
        for j in c['raw_jobs']:
            t=j.get('title') or j.get('text') or ''
            if not FIN.search(t) or LEAD.search(t) or JUN.search(t): continue
            if re.search(r'data scien',t,re.I): continue
            if ats=='greenhouse':
                loc=(j.get('location') or {}).get('name',''); rf='remote' in loc.lower(); wt=''
                jd=strip(j.get('content','')); ts=(j.get('updated_at') or j.get('created_at') or '')[:10]
                url=j.get('absolute_url','')
                comp=''
                for m in (j.get('metadata') or []):
                    if 'salary' in str(m.get('name','')).lower() and m.get('value'): comp=str(m['value'])
            elif ats=='lever':
                cat=j.get('categories') or {}; loc=cat.get('location','') or ''
                wt=(cat.get('workplaceType') or '').lower(); rf=wt=='remote'
                jd=strip(j.get('descriptionPlain') or j.get('description','')); url=j.get('hostedUrl','')
                ts=datetime.datetime.utcfromtimestamp(j['createdAt']/1000).date().isoformat() if j.get('createdAt') else ''
                comp=''
            else: # ashby
                loc=j.get('location','') or ''; rf=bool(j.get('isRemote')); wt=''
                jd=strip(j.get('descriptionHtml') or j.get('descriptionPlain','')); url=j.get('jobUrl') or j.get('applyUrl','')
                ts=(j.get('publishedAt') or '')[:10]
                cc=j.get('compensation') or {}; comp=(cc.get('compensationTierSummary') if isinstance(cc,dict) else '') or ''
            conf=remote_us(loc, rf, wt, jd)
            if not conf: continue
            mn,mx=years(jd)
            if not yok(mn,mx): continue
            try:
                if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
            except: pass
            out.append({'company':c['name'],'funds':c['funds'],'role_title':t,'location':loc,'remote_conf':conf,
                        'posted_date':ts,'years_req':yreq(mn,mx),'comp_range':comp,'ats_link':url,'ats':ats})
    return out

roles=[]
for p in sys.argv[1:]:
    roles+=extract(p)
json.dump(roles,open('direct_ats_roles.json','w'),indent=1)
print(f"remote-US FP&A roles (≤60d): {len(roles)}")
for r in sorted(roles,key=lambda x:x['company']):
    print(f"  {r['role_title'][:52]:52} @ {r['company']:16} | {r['location'][:26]:26} | {r['years_req']:6} | {r['posted_date']} | {r['ats']}")
