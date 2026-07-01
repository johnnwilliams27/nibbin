#!/usr/bin/env python3
import json, re, datetime, html
TODAY=datetime.date(2026,7,1); CUTOFF=TODAY-datetime.timedelta(days=60)
FIN=re.compile(r'\b(fp&a|fp and a|financial planning|strategic finance|corporate finance|finance & strategy|finance and strategy)\b',re.I)
LEAD=re.compile(r'\b(director|vp|vice president|head of|head,|chief|cfo|svp|evp)\b',re.I)
JUN=re.compile(r'\b(intern|internship|apprentice|co-op)\b',re.I)
US_STATES=set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming columbia".split())

def strip(t): return re.sub(r'<[^>]+>',' ',html.unescape(t or ''))
def years(txt):
    m=re.search(r'(\d{1,2})\s*\+?\s*(?:-|to|–)\s*(\d{1,2})\s*\+?\s*years',txt,re.I)
    if m: return int(m.group(1)),int(m.group(2))
    m=re.search(r'(\d{1,2})\s*\+\s*years',txt,re.I)
    if m: return int(m.group(1)),None
    m=re.search(r'minimum of\s*(\d{1,2})\s*years',txt,re.I)
    if m: return int(m.group(1)),None
    m=re.search(r'(\d{1,2})\s*years',txt,re.I)
    if m: return int(m.group(1)),None
    return None,None
def yok(mn,mx):
    if mn is not None and mn>8: return False
    if mx is not None and mx<5: return False
    return True
def us_remote(loc,txt,flag):
    l=(loc or '').lower(); b=l+' '+txt[:400].lower()
    if re.search(r'\bhybrid\b',l) or 'in office' in l or 'on-site' in l or 'onsite' in l:
        if 'remote' not in l: return False
    isrem = flag or 'remote' in l or 'remote' in txt[:300].lower()
    if not isrem: return False
    if 'united states' in b or 'remote - us' in b or 'remote, us' in b or ' usa' in b or 'u.s.' in b or 'us-based' in b or 'us based' in b: return True
    if any(st in b for st in US_STATES): return True
    if re.search(r'\bunited kingdom|canada|india|ireland|germany|europe|emea|apac|australia|singapore|latam\b',l): return False
    # remote with $ comp implies US in these boards
    return True

def scan_gh(c):
    out=[]
    for j in c['raw_jobs']:
        t=j.get('title','');
        if not FIN.search(t) or LEAD.search(t) or JUN.search(t): continue
        loc=(j.get('location') or {}).get('name','')
        txt=strip(j.get('content',''))
        if not us_remote(loc,txt,'remote' in loc.lower()): continue
        mn,mx=years(txt)
        if not yok(mn,mx): continue
        ts=(j.get('updated_at') or j.get('created_at') or '')[:10]
        out.append(mk(c,t,loc,ts,mn,mx,j.get('absolute_url',''),comp_gh(j)))
    return out
def comp_gh(j):
    for m in (j.get('metadata') or []):
        if 'salary' in str(m.get('name','')).lower(): return str(m.get('value',''))
    return ''
def scan_lever(c):
    out=[]
    for j in c['raw_jobs']:
        t=j.get('text','')
        if not FIN.search(t) or LEAD.search(t) or JUN.search(t): continue
        cat=j.get('categories') or {}
        loc=cat.get('location','') or ''; wt=(cat.get('workplaceType') or '')
        txt=strip(j.get('descriptionPlain') or j.get('description',''))
        if not us_remote(loc,txt, wt.lower()=='remote'): continue
        mn,mx=years(txt)
        if not yok(mn,mx): continue
        ts=''
        if j.get('createdAt'):
            ts=datetime.datetime.utcfromtimestamp(j['createdAt']/1000).date().isoformat()
        out.append(mk(c,t,loc,ts,mn,mx,j.get('hostedUrl',''),''))
    return out
def scan_ashby(c):
    out=[]
    for j in c['raw_jobs']:
        t=j.get('title','')
        if not FIN.search(t) or LEAD.search(t) or JUN.search(t): continue
        loc=j.get('location','') or ''
        txt=strip(j.get('descriptionHtml') or j.get('descriptionPlain',''))
        if not us_remote(loc,txt, bool(j.get('isRemote'))): continue
        mn,mx=years(txt)
        if not yok(mn,mx): continue
        ts=(j.get('publishedAt') or '')[:10]
        comp=''
        cc=j.get('compensation') or {}
        ct=(cc.get('compensationTierSummary') if isinstance(cc,dict) else '') or ''
        out.append(mk(c,t,loc,ts,mn,mx,j.get('jobUrl') or j.get('applyUrl',''),ct))
    return out
def yreq(mn,mx):
    if mn is None and mx is None: return 'n/s'
    if mx is None: return f"{mn}+"
    if mn is None: return f"<={mx}"
    return f"{mn}-{mx}"
def mk(c,t,loc,ts,mn,mx,url,comp):
    return {'company':c['name'],'domain':c['domain'],'funds':c['funds'],'role_title':t,
            'location':loc,'posted_date':ts,'years_req':yreq(mn,mx),'ats_link':url,'comp_range':comp}

data=json.load(open('hc_ats_scan.json'))
roles=[]
for c in data:
    if not c['ats']: continue
    roles += {'greenhouse':scan_gh,'lever':scan_lever,'ashby':scan_ashby}[c['ats']](c)
# posted cutoff
kept=[]
for r in roles:
    ts=r['posted_date']
    try:
        if ts and datetime.date.fromisoformat(ts)<CUTOFF: continue
    except: pass
    kept.append(r)
print(f"raw FP&A matches: {len(roles)} | within 60d: {len(kept)}")
for r in kept:
    print(f"  {r['role_title']} @ {r['company']} | {r['location']} | {r['years_req']} | {r['posted_date']} | {r['comp_range'][:40]} | {r['ats_link'][:55]}")
json.dump(kept,open('hc_roles.json','w'),indent=1)
