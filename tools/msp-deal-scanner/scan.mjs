#!/usr/bin/env node
// MSP Deal Scanner — evaluate MSP / IT-services acquisition targets against (1) a market
// valuation model and (2) the EMPIRE / Williams 20-Year Plan MSP buy box (strategic fit).
//
// Reads:  benchmarks.json (market model) + empire-profile.json (buy box) + listings.json (deals)
// Emits:  report.md, report.csv, report.html  (self-contained, in this folder)
//
// For each deal it: classifies the business, prices it against the market band (SDE vs EBITDA,
// with an MRR premium), computes the implied multiple, THEN scores strategic fit against the
// buy box — size window, recurring model, onshore vs offshore, price discipline, management
// depth, and vertical — and assigns a tier: Platform (Deal 1) / Tuck-in / Watch / Caution / Pass.
//
// Zero dependencies. Usage: node tools/msp-deal-scanner/scan.mjs [dir]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ? process.argv[2] : HERE;

const bm = JSON.parse(readFileSync(join(DIR, 'benchmarks.json'), 'utf8'));
const EMPIRE = JSON.parse(readFileSync(join(DIR, 'empire-profile.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(DIR, 'listings.json'), 'utf8'));

const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const x = (n) => (n == null ? '—' : n.toFixed(2) + '×');
// Parse ONLY listing-authored text (headline + sector + description) for classification and
// signals — never the analyst `notes`, so editorial commentary ("high for an MSP", "the GM is a
// contractor") can't fabricate positive signals.
const hay = (L) => `${L.headline} ${L.sector || ''} ${L.description || ''}`.toLowerCase();

// ---- capital-stack financeability (Structure 1) ---------------------------
// Envelope = $5M 7(a) + up to $1M seller note + up to $0.7M cash equity ≈ $6.7M for the
// business. Real estate, if any, rides a SEPARATE 504/CRE loan and does not eat that envelope.
function stackNote(earnings, ask, L) {
  const CS = EMPIRE.capitalStack, env = CS.businessEnvelope;
  const reLoan = (L.realEstate && L.realEstate.included && L.realEstate.value) ? Math.round(L.realEstate.value * CS.reLoanLtv) : 0;
  const cap = env + reLoan;
  if (ask != null) {
    return ask <= cap
      ? `Ask ${usd(ask)} fits the ~${usd(cap)} financeable envelope (7(a) + seller note + equity${reLoan ? ` + ${usd(reLoan)} RE loan` : ''}).`
      : `Ask ${usd(ask)} is over the ~${usd(cap)} financeable envelope — needs more equity, a bigger seller note, a price cut${reLoan ? '' : ', or an RE carve-out'}.`;
  }
  if (earnings != null) {
    const maxMult = cap / earnings;
    return `To stay inside the ~${usd(cap)} envelope, hold price to ~${maxMult.toFixed(1)}× (~${usd(cap)}). Consolidators bid 5–8× at this size, so it likely only pencils off-market or on seller conviction.`;
  }
  return null;
}

// ---- classification -------------------------------------------------------
// Classify off the headline + an explicit `sector` field only — never the free-text
// `notes`, so editorial prose (e.g. "not an MSP") can't poison the classifier.
function classify(L) {
  const h = hay(L);
  const any = (arr) => arr.some((p) => h.includes(p));
  if (any(bm.classification.msp)) return 'MSP / IT-services';
  if (any(bm.classification.it_services_adjacent)) return 'IT-services adjacent';
  if (any(bm.classification.not_msp)) return 'Not an MSP';
  return 'Unclassified';
}

// ---- valuation band -------------------------------------------------------
function band(L) {
  if (L.ebitda != null) {
    const t = bm.ebitdaTiers.find((t) => t.maxEBITDA == null || L.ebitda <= t.maxEBITDA);
    return { basis: 'EBITDA', value: L.ebitda, tier: t.label, low: t.low, high: t.high };
  }
  if (L.sde != null) {
    const t = bm.sdeTiers.find((t) => t.maxSDE == null || L.sde <= t.maxSDE);
    return { basis: 'SDE', value: L.sde, tier: t.label, low: t.low, high: t.high };
  }
  return null;
}

// ---- signals --------------------------------------------------------------
function readSignals(L) {
  const h = hay(L);
  const flags = [];
  let adj = 0;
  let recurring = false;
  for (const group of ['positive', 'negative']) {
    for (const [key, s] of Object.entries(bm.signals[group])) {
      if (s.patterns.some((p) => h.includes(p))) {
        flags.push({ key, weight: s.weight, flag: s.flag });
        adj += s.weight;
        if (key === 'recurring') recurring = true;
      }
    }
  }
  return { flags, adj, recurring };
}

// ---- market valuation of one listing --------------------------------------
function evaluate(L) {
  const kind = classify(L);
  const b = band(L);
  const sig = readSignals(L);
  const prem = sig.recurring ? bm.mrrPremiumTurns : 0;
  const loAdj = b ? b.low + prem : null;
  const hiAdj = b ? b.high + prem : null;

  let impliedMultiple = null, position = null, impliedRange = null, verdict, dataOk = true;
  if (b && L.askingPrice != null) {
    impliedMultiple = L.askingPrice / b.value;
    position = impliedMultiple < loAdj ? 'below' : impliedMultiple > hiAdj ? 'above' : 'in';
  } else if (b && L.askingPrice == null) {
    impliedRange = [Math.round(b.value * loAdj), Math.round(b.value * hiAdj)];
  } else dataOk = false;

  if (!b) verdict = 'No earnings disclosed — request P&L / add-back schedule.';
  else if (impliedRange) verdict = `Price withheld — at ${x(loAdj)}–${x(hiAdj)} ${b.basis} implies ${usd(impliedRange[0])}–${usd(impliedRange[1])}.`;
  else if (position === 'below') verdict = `Below the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — cheap on paper; screen for why.`;
  else if (position === 'in') verdict = `In the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — fair market ask.`;
  else verdict = `Above the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — rich.`;

  return { L, kind, band: b, prem, loAdj, hiAdj, impliedMultiple, impliedRange, position, sig, dataOk, verdict };
}

// ---- EMPIRE strategic fit -------------------------------------------------
const TIER = { platform: 'Platform (Deal 1)', tuckin: 'Tuck-in', watch: 'Watch — need numbers', caution: 'Caution — thesis conflict', pass: 'Pass' };
const TIER_ORDER = { platform: 0, tuckin: 1, watch: 2, caution: 3, pass: 4 };

// Geography scores CUSTOMER REACH / remote-operability, not just HQ city: a broad or remote
// client base is operable from Dallas regardless of where the seller sits; a single-market
// onsite base ties you to that metro. HQ metro is only a small tiebreaker.
function geoScore(L) {
  const G = EMPIRE.geography, W = EMPIRE.fitWeights.onshoreGeo;
  const c = (L.city || '').toLowerCase();
  const home = EMPIRE.home.some((k) => c.includes(k));
  const metro = EMPIRE.acceptableMetros.some((k) => c.includes(k));
  const reach = (L.customerGeography || 'unknown').toLowerCase();
  let mult = G.reachMultipliers[reach], tag;
  if (mult == null) {
    mult = home ? 0.7 : metro ? 0.55 : (c.includes('texas') || c.includes(', tx')) ? 0.5 : 0.4;
    tag = `Onshore, HQ ${home ? 'DFW' : metro ? 'TX metro' : 'TX'} — customer reach unknown; confirm it isn't a single-market onsite base`;
  } else {
    const portable = ['multi-state', 'national', 'statewide', 'remote', 'regional'].includes(reach);
    if (home && !portable) mult = Math.min(1, mult + G.homeMetroBonus);
    tag = `Onshore, ${reach} customer reach${home ? ' + DFW home' : ''} — ${portable ? 'operable from Dallas regardless of HQ' : 'tied to the local market'}`;
  }
  return { pts: W * mult, tag };
}

function computeFit(r) {
  const L = r.L, sig = r.sig, W = EMPIRE.fitWeights, reasons = [];
  const h = hay(L);
  const earnings = L.ebitda ?? L.sde ?? null;
  const has = (k) => sig.flags.some((f) => f.key === k);
  const offshore = has('offshore'), notOperating = has('not_operating');
  const breakFix = has('break_fix'), reseller = has('hardware_reseller'), hype = has('hype');
  const projectMix = has('project_mix');
  const recurring = sig.recurring;
  const isMsp = r.kind.startsWith('MSP');

  if (r.kind === 'Not an MSP') { reasons.push('Not an MSP / IT-services business — outside the mandate.'); return { tier: 'pass', score: 8, reasons }; }
  if (notOperating) { reasons.push('Franchise / startup / license — not a retiring-owner operating platform; royalty drag, no clean equity re-rate.'); return { tier: 'pass', score: 12, reasons }; }

  let s = 0;
  const anchor = h.includes('anchor');

  // RECURRING REVENUE QUALITY (heavily weighted — the core of MSP value and of SBA financeability)
  {
    const p = L.recurringPct;
    if (p != null) {
      const mult = p >= 90 ? 1 : p >= 80 ? 0.9 : p >= 70 ? 0.75 : p >= 50 ? 0.5 : 0.2;
      s += W.recurring * mult;
      reasons.push(`~${p}% recurring — ${p >= 80 ? 'strong contractual base (target 90%+)' : p >= 50 ? 'moderate; the project share dilutes MRR and SBA discounts it' : 'project-heavy, low MRR — weak base and an SBA underwriting concern'}.`);
    } else if (breakFix) { s += W.recurring * 0.1; reasons.push('Break/fix model — little recurring revenue to compound or finance against.'); }
    else if (reseller) { s += W.recurring * 0.2; reasons.push('Resale-weighted — non-recurring, thin margins.'); }
    else if (recurring && projectMix) { s += W.recurring * 0.45; reasons.push('Managed + project/install mix — confirm the recurring %; SBA credits contractual MRR and discounts project/one-time revenue.'); }
    else if (recurring) { s += W.recurring * 0.6; reasons.push('Managed/recurring language, MRR % unconfirmed — confirm it (target 90%+; it drives both value and the loan).'); }
    else { s += W.recurring * 0.45; reasons.push('Recurring mix unconfirmed — confirm MRR %.'); }
  }

  // CUSTOMER CONCENTRATION & COUNT (low concentration + broad base — a top SBA underwriting test)
  {
    const top = L.topClientPct, n = L.clientCount, W2 = W.concentration;
    if (top != null) {
      const mult = top <= 10 ? 1 : top <= 15 ? 0.85 : top <= 25 ? 0.5 : 0.15;
      s += W2 * mult;
      reasons.push(`Top client ~${top}% of revenue — ${top <= 15 ? 'diversified, meets the <15% rule' : top <= 25 ? 'moderate concentration; SBA will probe' : 'HIGH concentration — a documented SBA decline reason without mitigation'}${n != null ? ` (${n} clients)` : ''}.`);
    } else if (n != null) {
      let mult = n >= 100 ? 0.9 : n >= 50 ? 0.75 : n >= 20 ? 0.55 : 0.3;
      let note = `${n} clients — ${n >= 50 ? 'broad base, concentration likely low' : n >= 20 ? 'moderate count' : 'thin base, concentration risk'}`;
      if (anchor && n < 40) { mult = Math.min(mult, 0.35); note += '; anchor/key accounts flagged — concentration risk despite the count'; }
      s += W2 * mult;
      reasons.push(`${note} (confirm the top-client %).`);
    } else if (anchor) { s += W2 * 0.35; reasons.push('Anchor/key accounts cited but client mix undisclosed — concentration risk; get the top-client % (an SBA decline trigger).'); }
    else { s += W2 * 0.5; reasons.push('Client count & top-client % not disclosed — a top SBA diligence item (concentration is a documented decline reason).'); }
  }

  // SIZE
  const pw = EMPIRE.platformWindow, tw = EMPIRE.tuckInWindow;
  let sizeClass = 'unknown';
  if (earnings == null) { s += W.size * 0.5; reasons.push('Earnings not disclosed — size fit unknown.'); }
  else if (earnings > pw.stretchMax) { s += W.size * 0.45; sizeClass = 'too-big'; reasons.push(`~${usd(earnings)} earnings is above even the seller-note-stretched window (~$1.8M) — the business price clears the financeable envelope.`); }
  else if (earnings >= pw.minEarnings) {
    s += W.size; sizeClass = 'platform';
    const sweet = earnings >= pw.sweetLow && earnings <= pw.sweetHigh;
    reasons.push(`~${usd(earnings)} earnings sits in the Deal-1 platform window${sweet ? ' (sweet spot)' : earnings > pw.sweetHigh ? ' — top edge; needs a full seller note to finance' : ' — small end; under-uses your borrowing capacity'}.`);
  }
  else if (earnings >= tw.minEarnings) { s += W.size * 0.6; sizeClass = 'tuckin'; reasons.push(`~${usd(earnings)} earnings is tuck-in scale — fold into the platform, not a standalone Deal 1.`); }
  else { s += W.size * 0.25; sizeClass = 'too-small'; reasons.push(`~${usd(earnings)} earnings is sub-scale even for a tuck-in.`); }

  // ONSHORE / GEO (customer reach + remote-operability, not just HQ)
  if (offshore) reasons.push("OFFSHORE delivery — clashes with the legal / professional-services vertical, is undercut by the plan's own AI-L1 thesis, and is discounted at exit. The cheap multiple buys lower-quality, less-transferable earnings.");
  else { const g = geoScore(L); s += g.pts; reasons.push(`${g.tag}.`); }

  // PRICE DISCIPLINE
  const m = r.impliedMultiple, pd = EMPIRE.priceDiscipline;
  if (m == null) { s += W.priceDiscipline * 0.5; reasons.push('Price withheld — cannot test the ≤5× discipline; request the number.'); }
  else if (m <= pd.tuckInMax) { s += W.priceDiscipline; reasons.push(`${x(m)} ${r.band.basis} — inside even the tuck-in discipline.`); }
  else if (m <= pd.platformMax) { s += W.priceDiscipline * 0.8; reasons.push(`${x(m)} ${r.band.basis} — within platform price discipline.`); }
  else if (m <= 6) { s += W.priceDiscipline * 0.4; reasons.push(`${x(m)} ${r.band.basis} — above discipline; needs a strategic reason.`); }
  else reasons.push(`${x(m)} ${r.band.basis} — well over discipline; pass on price unless repriced.`);

  // MANAGEMENT / TRANSFERABILITY
  if (/\bgm\b|service manager|management team|manager in place/.test(h)) { s += W.management; reasons.push('Management/GM signal — supports the owner exit (non-negotiable).'); }
  else if (has('established') || /retir/.test(h)) { s += W.management * 0.6; reasons.push('Established / retiring owner — confirm a GM owns the client relationships.'); }
  else if (hype) { s += W.management * 0.2; reasons.push('Absentee/lifestyle framing — scrutinize owner dependence.'); }
  else { s += W.management * 0.4; reasons.push('Management depth unknown — owner-exit test unproven.'); }

  // HEADCOUNT / KEY-PERSON
  if (L.employees != null) {
    const e = L.employees;
    reasons.push(`~${e} staff — ${e >= 15 ? 'platform-scale team' : e >= 6 ? 'lean team; confirm depth beyond the owner and key techs, and how many transfer' : 'very thin headcount — owner / key-person dependence risk'}.`);
  } else if (['platform', 'too-big', 'tuckin'].includes(sizeClass)) {
    reasons.push('Headcount not disclosed — confirm team size, how many are onshore/local, and how many transfer at close.');
  }

  // MARGIN / QUALITY OF EARNINGS
  if (L.grossRevenue && earnings != null) {
    const margin = earnings / L.grossRevenue;
    if (margin > 0.35) reasons.push(`~${Math.round(margin * 100)}% margin is high for an MSP (norm ~10–25%) — expect heavy add-backs; put quality-of-earnings first.`);
  }

  // VERTICAL
  const V = EMPIRE.verticalTiebreaker;
  if (V.best.some((k) => h.includes(k))) { s += W.vertical; reasons.push('Legal-vertical concentration — best-case tiebreaker.'); }
  else if (V.second.some((k) => h.includes(k))) { s += W.vertical * 0.7; reasons.push('Professional/financial-services vertical — strong secondary fit.'); }
  else if (h.includes('cyber') || h.includes('security')) { s += W.vertical * 0.6; reasons.push('Security capability — margin-accretive, sells the vertical.'); }
  else if (V.acceptable_no_premium.some((k) => h.includes(k))) { s += W.vertical * 0.3; reasons.push('Healthcare exposure — acceptable, no premium (DSO headwind).'); }

  // CAPITAL STACK (financeability under Structure 1)
  if (['platform', 'too-big', 'tuckin'].includes(sizeClass)) {
    const sn = stackNote(earnings, L.askingPrice, L);
    if (sn) reasons.push(sn);
  }

  // SELLER FINANCING
  const sf = L.sellerFinancing;
  if (sf === 'yes') { s += 4; reasons.push('Seller financing offered — stretches your cash equity and signals conviction post-close.'); }
  else if (sf === 'no') reasons.push('No seller financing indicated — you cover the full equity gap in cash; confirm, it changes what you can afford.');
  else if (!breakFix && sizeClass !== 'too-small') reasons.push('Seller financing unconfirmed — top-3 diligence item; half the 10% injection can be seller standby paper, so it decides what you can afford.');

  // REAL ESTATE
  if (L.realEstate && L.realEstate.included) reasons.push(`Real estate included${L.realEstate.value ? ` (~${usd(L.realEstate.value)})` : ''} — finance separately (504/CRE, outside the 7(a)); lifts the ceiling, but you prefer minimal RE for an asset-light MSP.`);

  // SBA UNDERWRITING READ — Deal 1 must clear 7(a) underwriting, not just the buy box
  {
    const flags = [];
    if (L.topClientPct != null && L.topClientPct > 20) flags.push(`a ~${L.topClientPct}% top client is a documented decline reason — needs mitigation`);
    else if (anchor || (L.clientCount != null && L.clientCount < 20)) flags.push('concentration / anchor exposure — underwriters will probe the top-client %');
    if (L.recurringPct != null && L.recurringPct < 60) flags.push('sub-60% recurring — lenders discount project/one-time revenue');
    else if (projectMix && L.recurringPct == null) flags.push('project/install mix — lenders weight stable recurring cash flow');
    if (L.grossRevenue && earnings != null && earnings / L.grossRevenue > 0.35) flags.push('above-norm adjusted margin — add-backs get normalized down, lowering the supportable loan');
    if (m != null && m > pd.platformMax) flags.push(`priced above ${pd.platformMax}× — SBA won't lend above an independent valuation, so a consolidator-priced ask can't be SBA-funded at that number`);
    if (!/\bgm\b|service manager|management team|manager in place/.test(h) && !has('established')) flags.push('transferability — seller involvement caps at ~12 mo; confirm the business runs without the owner');
    if (flags.length) reasons.push('SBA underwriting: ' + flags.join('; ') + '.');
    else if (sizeClass === 'platform') reasons.push('SBA underwriting: at Structure-1 leverage the DSCR on this earnings level clears the ~1.15× floor with cushion; document concentration, recurring %, and add-backs and it should underwrite.');
  }

  s = Math.max(0, Math.min(100, Math.round(s)));

  // TIER — evaluated ONLY as a candidate for the initial platform purchase (Deal 1).
  // Tuck-ins are out of scope for now: anything below the platform size floor is a Pass,
  // noted as a possible tuck-in to revisit after the platform closes.
  let tier;
  if (offshore) tier = 'caution';
  else if (m != null && m > pd.platformMax + 1) tier = 'pass';
  else if (sizeClass === 'tuckin' || sizeClass === 'too-small') { tier = 'pass'; reasons.push('Below the ~$800K Deal-1 size floor — a possible tuck-in *after* the platform closes, not an initial purchase.'); }
  else if (breakFix || reseller) tier = 'pass';
  else if (earnings == null && m == null) tier = 'watch';
  else if (sizeClass === 'too-big') { tier = 'watch'; reasons.push('Platform-quality but above even the seller-note-stretched window — needs price/structure work; verify the number.'); }
  else if (sizeClass === 'platform' && isMsp && (m == null || m <= pd.platformMax)) tier = 'platform';
  else tier = 'pass';

  // Score reflects fit *as the initial purchase*. A deal that fails the Deal-1 gate (off-thesis
  // or below the size floor) scores low even if it's a fine business on its own — so the number
  // never outranks a real Platform candidate.
  const score = (tier === 'pass' || tier === 'caution') ? Math.round(s * 0.6) : s;
  return { tier, score, reasons };
}

// ---- duplicate detection --------------------------------------------------
function markDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.L.askingPrice == null || r.L.sde == null) continue;
    const k = `${r.L.askingPrice}|${r.L.sde}`;
    if (seen.has(k)) { r.dupOf = seen.get(k); rows.find((x) => x.L.id === seen.get(k)).hasDup = true; }
    else seen.set(k, r.L.id);
  }
}

// ---- run ------------------------------------------------------------------
const rows = data.listings.map(evaluate);
markDuplicates(rows);
for (const r of rows) r.fit = computeFit(r);
rows.sort((a, b) => (TIER_ORDER[a.fit.tier] - TIER_ORDER[b.fit.tier]) || (b.fit.score - a.fit.score));

const byTier = (t) => rows.filter((r) => r.fit.tier === t);
const counts = Object.fromEntries(Object.keys(TIER).map((t) => [t, byTier(t).length]));

// ---- markdown -------------------------------------------------------------
const md = [];
md.push('# Texas MSP / IT-Services Acquisition Scan — ranked against the EMPIRE buy box');
md.push('');
md.push(`_Generated by \`tools/msp-deal-scanner/scan.mjs\`, data captured ${data.capturedOn}. **MSP / managed-IT-services businesses only** — resellers, repair shops, ISP/telecom, franchise, digital-marketing, and office-tech removed. Includes **Texas listings plus out-of-state MSPs that are remote-delivered** (national/remote client base), since those are operable from Dallas; single-market onsite out-of-state shops are excluded. Each business is judged **only as a candidate for the initial platform purchase (Deal 1)**; here **Pass means "not an initial purchase"** (below the ~$800K size floor → a future tuck-in, or off-thesis), not "not an MSP." Ranked by fit to the buy box (size window, 90%+ MRR, onshore, GM-in-place, ≤5× discipline, legal-vertical tiebreaker), not raw cheapness. A **blank multiple means the asking price is withheld** — the tool shows an implied range from earnings and "get the ask" becomes the diligence item. Financials are **unverified** — confirm against the CIM. See \`ANALYSIS.md\` for the reasoning._`);
md.push('');
md.push('## Tiers');
md.push('');
md.push(`- **Platform (Deal 1):** ${counts.platform} · **Watch (need numbers):** ${counts.watch} · **Caution (thesis conflict):** ${counts.caution} · **Pass:** ${counts.pass}`);
md.push('');
for (const t of ['platform', 'watch', 'caution', 'pass']) {
  const list = byTier(t);
  if (!list.length) continue;
  md.push(`### ${TIER[t]}`);
  md.push('');
  md.push('| Fit | Business | Location | Ask | Earnings | Impl. × | Market read | Why this tier |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const r of list) {
    const L = r.L;
    const earn = L.ebitda != null ? `${usd(L.ebitda)} EBITDA` : L.sde != null ? `${usd(L.sde)} SDE` : '—';
    const mult = r.impliedMultiple != null ? `${x(r.impliedMultiple)} ${r.band.basis}` : (r.impliedRange ? `→ ${usd(r.impliedRange[0])}–${usd(r.impliedRange[1])}` : '—');
    const dup = r.dupOf ? ' ⚠︎dup' : '';
    const why = r.fit.reasons[0];
    md.push(`| ${r.fit.score} | ${L.headline}${dup} | ${L.city} | ${usd(L.askingPrice)} | ${earn} | ${mult} | ${r.verdict} | ${why} |`);
  }
  md.push('');
}
md.push('## Full rationale, deal by deal');
md.push('');
for (const t of ['platform', 'watch', 'caution', 'pass']) {
  for (const r of byTier(t)) {
    md.push(`**${r.L.headline}** — _${TIER[t]} · fit ${r.fit.score}/100_  `);
    md.push(r.fit.reasons.map((x) => `- ${x}`).join('\n'));
    md.push('');
  }
}
md.push('## The buy box being scored against (`empire-profile.json`)');
md.push('');
md.push('- **Size:** $1.0–1.5M EBITDA sweet spot (Deal 1), stretchable to ~$1.8M with a full seller note; tuck-ins $120k–$800k.');
md.push('- **Capital stack (Structure 1):** $5M SBA 7(a) + $0.7–1M seller note (10–15%, 2-yr standby) + $0.5–0.7M cash ≈ **$6.7M business envelope** (~$6.5–7M price). Real estate rides a separate 504/CRE loan outside the 7(a) and lifts the ceiling further.');
md.push('- **Model:** 90%+ contractual MRR, per-seat; ≥20 clients, none >15%, 85%+ retention.');
md.push('- **People:** a GM/service manager who owns relationships so the seller can exit — non-negotiable.');
md.push('- **Price discipline:** platform ≤5×, tuck-ins ≤3.5×. Note: $1–3M-EBITDA MSPs clear at 5–8× with consolidators, so a 4.75–5× financed offer usually only wins off-market or on seller conviction.');
md.push('- **Vertical tiebreaker:** legal best, professional/financial second, healthcare no-premium; generalist chassis with concentration beats vertical-only.');
md.push('- **Onshore:** relationship + AI-L1 model — offshore labor arbitrage fights the vertical, the AI thesis, and the exit multiple. See `ANALYSIS.md`.');
md.push('');
md.push('_Not investment advice; a sourcing/screening aid. Every figure is unverified — confirm before acting._');
writeFileSync(join(DIR, 'report.md'), md.join('\n'));

// ---- csv ------------------------------------------------------------------
const csvHead = ['fit_tier', 'fit_score', 'id', 'headline', 'city', 'kind', 'asking_price', 'sde', 'ebitda', 'basis', 'implied_multiple', 'market_position', 'duplicate_of', 'verified', 'source', 'top_reason', 'verdict'];
const csvRows = rows.map((r) => [
  TIER[r.fit.tier], r.fit.score, r.L.id, r.L.headline, r.L.city, r.kind, r.L.askingPrice ?? '', r.L.sde ?? '', r.L.ebitda ?? '',
  r.band?.basis ?? '', r.impliedMultiple?.toFixed(2) ?? '', r.position ?? '', r.dupOf ?? '', r.L.verified, r.L.source, r.fit.reasons[0], r.verdict,
].map((c) => { const s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','));
writeFileSync(join(DIR, 'report.csv'), [csvHead.join(','), ...csvRows].join('\n'));

// ---- html -----------------------------------------------------------------
const tierColor = { platform: '#16a34a', tuckin: '#65a30d', watch: '#d97706', caution: '#ea580c', pass: '#9ca3af' };
const section = (t) => {
  const list = byTier(t); if (!list.length) return '';
  const rowsH = list.map((r) => {
    const L = r.L;
    const earn = L.ebitda != null ? `${usd(L.ebitda)} <span class="dim">EBITDA</span>` : L.sde != null ? `${usd(L.sde)} <span class="dim">SDE</span>` : '—';
    const mult = r.impliedMultiple != null ? `${x(r.impliedMultiple)}` : (r.impliedRange ? `<span class="dim">→</span> ${usd(r.impliedRange[0])}–${usd(r.impliedRange[1])}` : '—');
    return `<tr>
      <td><span class="score" style="background:${tierColor[t]}">${r.fit.score}</span></td>
      <td><strong>${L.headline}</strong>${r.dupOf ? ' <span class="dup">dup</span>' : ''}<div class="dim">${L.city} · <a href="${L.source}" target="_blank" rel="noopener">source</a>${L.broker ? ` · broker: ${L.broker}` : ''} · unverified</div><ul class="why">${r.fit.reasons.slice(0, 3).map((x) => `<li>${x}</li>`).join('')}</ul></td>
      <td>${usd(L.askingPrice)}</td><td>${earn}</td><td>${mult}</td></tr>`;
  }).join('');
  return `<h2><span class="pill" style="background:${tierColor[t]}">${TIER[t]}</span> <span class="dim">${list.length}</span></h2>
    <div class="scroll"><table><thead><tr><th>Fit</th><th>Business & rationale</th><th>Ask</th><th>Earnings</th><th>Impl.×</th></tr></thead><tbody>${rowsH}</tbody></table></div>`;
};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Texas MSP Scan — EMPIRE buy box</title><style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1c1917;--dim:#78716c;--line:#e7e5e4;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--dim:#a8a29e;--line:#292524;--card:#262322}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem 1.25rem}
.wrap{max-width:1120px;margin:0 auto}h1{font-size:1.55rem;margin:0 0 .25rem}.sub{color:var(--dim);margin:0 0 1.25rem;font-size:.88rem}
h2{font-size:1.05rem;margin:1.75rem 0 .6rem;display:flex;align-items:center;gap:.5rem}
.pill{color:#fff;font-size:.8rem;padding:.15rem .6rem;border-radius:999px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:720px;font-size:.86rem}
th,td{text-align:left;padding:.6rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}
.dim{color:var(--dim);font-size:.8rem}
.score{display:inline-block;min-width:2rem;text-align:center;color:#fff;font-weight:700;border-radius:7px;padding:.15rem .4rem}
.why{margin:.4rem 0 0;padding-left:1rem;color:var(--dim);font-size:.8rem}.why li{margin:.1rem 0}
.dup{background:#dc2626;color:#fff;font-size:.62rem;padding:.05rem .3rem;border-radius:4px;vertical-align:middle}
a{color:inherit}.note{margin-top:1.5rem;color:var(--dim);font-size:.82rem;border-top:1px solid var(--line);padding-top:1rem}
</style></head><body><div class="wrap">
<h1>Texas MSP / IT-Services Scan — ranked by EMPIRE buy-box fit</h1>
<p class="sub">Data captured ${data.capturedOn} · ${rows.length} listings · <strong>unverified</strong> — confirm every figure against the CIM. Ranked by strategic fit to Deal 1, not raw cheapness. Reasoning: <code>ANALYSIS.md</code>.</p>
${['platform', 'watch', 'caution', 'pass'].map(section).join('\n')}
<p class="note"><strong>Buy box:</strong> $1–1.5M EBITDA/SDE platform ($120–800k tuck-ins), 90%+ MRR, GM-in-place, ≤4.5× (tuck-ins ≤3.5×), avoid &gt;$6M (SBA cap), legal-vertical tiebreaker, onshore. <strong>Offshore</strong> is flagged Caution: cheap earnings that fight the vertical, the AI-L1 margin thesis, and the exit multiple. Model editable in <code>empire-profile.json</code>; re-run <code>node tools/msp-deal-scanner/scan.mjs</code>.</p>
</div></body></html>`;
writeFileSync(join(DIR, 'report.html'), html);

// ---- console --------------------------------------------------------------
console.log(`${rows.length} listings · Platform ${counts.platform} · Watch ${counts.watch} · Caution ${counts.caution} · Pass ${counts.pass}`);
for (const t of ['platform', 'watch', 'caution', 'pass']) {
  for (const r of byTier(t)) console.log(`  ${TIER[t].padEnd(24)} [${String(r.fit.score).padStart(3)}] ${r.L.headline.slice(0, 44)}`);
}
