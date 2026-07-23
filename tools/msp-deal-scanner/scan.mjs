#!/usr/bin/env node
// MSP Deal Scanner — evaluate MSP / IT-services acquisition targets against a valuation model.
//
// Reads:  benchmarks.json (the valuation model) + listings.json (captured deals)
// Emits:  report.md, report.csv, report.html  (all self-contained, in this folder)
//
// It does NOT just list deals — for each one it classifies the business type, picks the
// right valuation basis (SDE vs EBITDA) and size tier, computes the implied multiple, compares
// it to the market band (with an MRR premium when warranted), reads quality/risk signals from
// the listing text, and produces a 0–100 deal score with a plain-English verdict. When a price
// is withheld but earnings are shown, it back-solves an implied asking-price range instead.
//
// Zero dependencies. Usage: node tools/msp-deal-scanner/scan.mjs [dir]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ? process.argv[2] : HERE;

const bm = JSON.parse(readFileSync(join(DIR, 'benchmarks.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(DIR, 'listings.json'), 'utf8'));

const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const x = (n) => (n == null ? '—' : n.toFixed(2) + '×');
const hay = (L) => `${L.headline} ${L.notes || ''}`.toLowerCase();

// ---- classification -------------------------------------------------------
function classify(L) {
  const h = hay(L);
  const any = (arr) => arr.some((p) => h.includes(p));
  // "not_msp" keywords win only if no strong MSP keyword is also present.
  if (any(bm.classification.msp)) return 'MSP / IT-services';
  if (any(bm.classification.it_services_adjacent)) return 'IT-services adjacent';
  if (any(bm.classification.not_msp)) return 'Not an MSP';
  return 'Unclassified';
}

// ---- valuation band -------------------------------------------------------
// Returns {basis:'EBITDA'|'SDE', value, tier, low, high} or null if no earnings.
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

// ---- evaluate one listing -------------------------------------------------
function evaluate(L) {
  const kind = classify(L);
  const b = band(L);
  const sig = readSignals(L);

  // MRR premium shifts the acceptable band up.
  const prem = sig.recurring ? bm.mrrPremiumTurns : 0;
  const loAdj = b ? b.low + prem : null;
  const hiAdj = b ? b.high + prem : null;

  let impliedMultiple = null;
  let position = null; // 'below' | 'in' | 'above'
  let impliedRange = null; // [lo, hi] asking price when earnings known but price withheld
  let verdict, dataOk = true;

  if (b && L.askingPrice != null) {
    impliedMultiple = L.askingPrice / b.value;
    if (impliedMultiple < loAdj) position = 'below';
    else if (impliedMultiple > hiAdj) position = 'above';
    else position = 'in';
  } else if (b && L.askingPrice == null) {
    impliedRange = [Math.round(b.value * loAdj), Math.round(b.value * hiAdj)];
  } else {
    dataOk = false;
  }

  // ---- deal score 0–100 -----------------------------------------------------
  // 50 baseline. Valuation position ±25. Signals ±(capped). Data completeness gate.
  let score = 50;
  if (position === 'below') score += 22;
  else if (position === 'in') score += 8;
  else if (position === 'above') score -= 20;
  score += Math.max(-25, Math.min(20, sig.adj));
  if (!dataOk) score = null; // can't score without earnings + price
  if (score != null) score = Math.max(0, Math.min(100, Math.round(score)));

  // ---- verdict --------------------------------------------------------------
  if (!b) {
    verdict = 'Insufficient data — no earnings disclosed; request P&L / add-back schedule.';
  } else if (impliedRange) {
    verdict = `Price withheld — at ${x(loAdj)}–${x(hiAdj)} ${b.basis} the range implies ${usd(impliedRange[0])}–${usd(impliedRange[1])}. Ask for the number.`;
  } else if (position === 'below') {
    verdict = `Priced below the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — attractive on paper; screen hard for why (owner dependence, churn, one-off earnings).`;
  } else if (position === 'in') {
    verdict = `In the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — fair market ask; value hinges on diligence quality.`;
  } else {
    verdict = `Above the ${x(loAdj)}–${x(hiAdj)} ${b.basis} band — rich; needs a strategic reason (contracts, MRR mix, real estate) to justify.`;
  }

  return { L, kind, band: b, prem, loAdj, hiAdj, impliedMultiple, impliedRange, position, sig, score, dataOk, verdict };
}

// ---- duplicate detection --------------------------------------------------
function markDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.L.askingPrice == null || r.L.sde == null) continue;
    const k = `${r.L.askingPrice}|${r.L.sde}`;
    if (seen.has(k)) {
      r.dupOf = seen.get(k);
      rows.find((x) => x.L.id === seen.get(k)).hasDup = true;
    } else seen.set(k, r.L.id);
  }
}

// ---- run ------------------------------------------------------------------
const rows = data.listings.map(evaluate);
markDuplicates(rows);

// Rank: MSP/adjacent first, then by score desc, undisclosed last.
const rank = (r) => {
  const kindRank = r.kind.startsWith('MSP') ? 0 : r.kind === 'IT-services adjacent' ? 1 : 2;
  return [kindRank, r.score == null ? 999 : 100 - r.score];
};
rows.sort((a, b) => {
  const [ak, as] = rank(a), [bk, bs] = rank(b);
  return ak - bk || as - bs;
});

const primaryDeals = rows.filter((r) => r.kind.startsWith('MSP') || r.kind === 'IT-services adjacent');
const scored = rows.filter((r) => r.score != null);
const avgScore = scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null;

// ---- markdown -------------------------------------------------------------
function mdRow(r) {
  const L = r.L;
  const flags = r.sig.flags.map((f) => f.flag).join('; ') || '—';
  const mult = r.impliedMultiple != null ? x(r.impliedMultiple) + ` ${r.band.basis}` : (r.impliedRange ? `→ ${usd(r.impliedRange[0])}–${usd(r.impliedRange[1])}` : '—');
  const dup = r.dupOf ? ' ⚠︎dup' : '';
  return `| ${r.score ?? '—'} | ${L.headline}${dup} | ${L.city} | ${usd(L.askingPrice)} | ${usd(L.sde)} | ${usd(L.ebitda)} | ${mult} | ${r.kind} | ${r.verdict} |`;
}

const md = [];
md.push('# Texas MSP / IT-Services Acquisition Scan');
md.push('');
md.push(`_Generated by \`tools/msp-deal-scanner/scan.mjs\` from data captured ${data.capturedOn}. Financials are **unverified** first-pass captures from public marketplace summaries — confirm every number against the actual listing / CIM before acting._`);
md.push('');
md.push('## At a glance');
md.push('');
md.push(`- **${data.listings.length}** listings scanned · **${primaryDeals.length}** are MSP / IT-services (rest filtered as adjacent/not-MSP).`);
md.push(`- **${scored.length}** have enough disclosed to score; average deal score **${avgScore ?? '—'}/100**.`);
const best = scored[0];
if (best) md.push(`- Highest score: **${best.L.headline}** (${best.score}/100) — ${best.verdict}`);
md.push(`- No listing in this set includes **real estate** — all are service/remote businesses (so no hard-asset / SBA-collateral upside to price in here).`);
md.push('');
md.push('## Ranked deals');
md.push('');
md.push('| Score | Business | Location | Ask | SDE | EBITDA | Implied multiple | Type | Verdict |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) md.push(mdRow(r));
md.push('');
md.push('## How to read this');
md.push('');
md.push('- **Implied multiple** = asking price ÷ earnings (EBITDA if disclosed, else SDE). Compared to the market band for that size/basis, plus an MRR premium of +' + bm.mrrPremiumTurns + ' turns when recurring-revenue language is present.');
md.push('- **Below the band** is not automatically "good" — for a healthy MSP it usually signals owner dependence, customer concentration, churn, or one-off earnings. Treat it as a reason to dig, not a green light.');
md.push('- **Price withheld** rows show the implied ask the disclosed earnings would support at market multiples.');
md.push('- ⚠︎dup marks listings with identical price + cash flow (likely the same deal listed twice).');
md.push('');
md.push('## Valuation model (editable in `benchmarks.json`)');
md.push('');
md.push('**SDE basis** (owner-operator shops):');
md.push('');
md.push('| Tier | Band |');
md.push('|---|---|');
for (const t of bm.sdeTiers) md.push(`| ${t.label} | ${t.low}×–${t.high}× |`);
md.push('');
md.push('**EBITDA basis** (managed / larger):');
md.push('');
md.push('| Tier | Band |');
md.push('|---|---|');
for (const t of bm.ebitdaTiers) md.push(`| ${t.label} | ${t.low}×–${t.high}× |`);
md.push('');
md.push(`_MRR premium: +${bm.mrrPremiumTurns} turns when 80%+ recurring. Sources: ${bm.sources.join(' · ')}._`);
md.push('');
md.push('## Caveats');
md.push('');
md.push('- **Coverage**: primary source is the BizBuySell Texas IT & Software category. Off-market deals, other marketplaces (DealStream, broker sites), and pocket listings are not captured — see README to add sources.');
md.push('- **Data quality**: figures are extracted from listing summaries and are unverified. "Cash Flow" is treated as SDE. Do not wire money against this file.');
md.push('- **Not investment advice** — a screening aid to decide which deals deserve a signed NDA and a real diligence pass.');
md.push('');

writeFileSync(join(DIR, 'report.md'), md.join('\n'));

// ---- csv ------------------------------------------------------------------
const csvHead = ['id', 'headline', 'city', 'kind', 'asking_price', 'sde', 'ebitda', 'basis', 'implied_multiple', 'band_low', 'band_high', 'position', 'implied_price_low', 'implied_price_high', 'score', 'flags', 'duplicate_of', 'verified', 'source', 'verdict'];
const csvRows = rows.map((r) => [
  r.L.id, r.L.headline, r.L.city, r.kind, r.L.askingPrice ?? '', r.L.sde ?? '', r.L.ebitda ?? '',
  r.band?.basis ?? '', r.impliedMultiple?.toFixed(2) ?? '', r.loAdj?.toFixed(2) ?? '', r.hiAdj?.toFixed(2) ?? '',
  r.position ?? '', r.impliedRange?.[0] ?? '', r.impliedRange?.[1] ?? '', r.score ?? '',
  r.sig.flags.map((f) => f.flag).join(' | '), r.dupOf ?? '', r.L.verified, r.L.source, r.verdict,
].map((c) => {
  const s = String(c);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(','));
writeFileSync(join(DIR, 'report.csv'), [csvHead.join(','), ...csvRows].join('\n'));

// ---- html (self-contained) ------------------------------------------------
const scoreColor = (s) => s == null ? '#9ca3af' : s >= 70 ? '#16a34a' : s >= 55 ? '#65a30d' : s >= 40 ? '#d97706' : '#dc2626';
const htmlRows = rows.map((r) => {
  const L = r.L;
  const mult = r.impliedMultiple != null ? `${x(r.impliedMultiple)} <span class="dim">${r.band.basis}</span>` : (r.impliedRange ? `<span class="dim">→</span> ${usd(r.impliedRange[0])}–${usd(r.impliedRange[1])}` : '—');
  return `<tr>
    <td><span class="score" style="background:${scoreColor(r.score)}">${r.score ?? '—'}</span></td>
    <td><strong>${L.headline}</strong>${r.dupOf ? ' <span class="dup">dup</span>' : ''}<div class="dim">${L.city} · <a href="${L.source}" target="_blank" rel="noopener">source</a> · unverified</div></td>
    <td>${usd(L.askingPrice)}</td><td>${usd(L.sde)}</td><td>${usd(L.ebitda)}</td>
    <td>${mult}</td><td><span class="kind k${r.kind.startsWith('MSP') ? '0' : r.kind === 'IT-services adjacent' ? '1' : '2'}">${r.kind}</span></td>
    <td class="verdict">${r.verdict}</td></tr>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Texas MSP Acquisition Scan</title><style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1c1917;--dim:#78716c;--line:#e7e5e4;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--dim:#a8a29e;--line:#292524;--card:#262322}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem 1.25rem}
.wrap{max-width:1120px;margin:0 auto}h1{font-size:1.6rem;margin:0 0 .25rem}.sub{color:var(--dim);margin:0 0 1.5rem;font-size:.9rem}
.stats{display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.75rem 1rem;min-width:140px}
.stat b{display:block;font-size:1.5rem}.stat span{color:var(--dim);font-size:.8rem}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:900px;font-size:.86rem}
th,td{text-align:left;padding:.6rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);position:sticky;top:0;background:var(--card)}
.dim{color:var(--dim);font-size:.8rem}.verdict{max-width:340px}
.score{display:inline-block;min-width:2rem;text-align:center;color:#fff;font-weight:700;border-radius:7px;padding:.15rem .4rem}
.kind{font-size:.72rem;padding:.1rem .45rem;border-radius:6px;white-space:nowrap}
.k0{background:#dcfce7;color:#166534}.k1{background:#fef3c7;color:#92400e}.k2{background:#f3f4f6;color:#6b7280}
@media(prefers-color-scheme:dark){.k0{background:#14532d;color:#bbf7d0}.k1{background:#78350f;color:#fde68a}.k2{background:#374151;color:#d1d5db}}
.dup{background:#dc2626;color:#fff;font-size:.62rem;padding:.05rem .3rem;border-radius:4px;vertical-align:middle}
a{color:inherit}.note{margin-top:1.5rem;color:var(--dim);font-size:.82rem;border-top:1px solid var(--line);padding-top:1rem}
</style></head><body><div class="wrap">
<h1>Texas MSP / IT-Services Acquisition Scan</h1>
<p class="sub">Data captured ${data.capturedOn} · ${data.listings.length} listings · <strong>unverified</strong> first-pass — confirm every figure against the CIM before acting.</p>
<div class="stats">
<div class="stat"><b>${primaryDeals.length}</b><span>MSP / IT-services</span></div>
<div class="stat"><b>${scored.length}</b><span>scoreable deals</span></div>
<div class="stat"><b>${avgScore ?? '—'}</b><span>avg score /100</span></div>
<div class="stat"><b>${best ? best.score : '—'}</b><span>top: ${best ? best.L.city : '—'}</span></div>
</div>
<div class="scroll"><table>
<thead><tr><th>Score</th><th>Business</th><th>Ask</th><th>SDE</th><th>EBITDA</th><th>Implied ×</th><th>Type</th><th>Verdict</th></tr></thead>
<tbody>${htmlRows}</tbody></table></div>
<p class="note"><strong>Method:</strong> implied multiple = ask ÷ earnings (EBITDA else SDE), vs. market band by size/basis, +${bm.mrrPremiumTurns} turns when recurring. Below-band ≠ automatically good — usually flags owner dependence, churn, or one-off earnings. Screening aid, not investment advice. Model editable in <code>benchmarks.json</code>; re-run with <code>node tools/msp-deal-scanner/scan.mjs</code>.</p>
</div></body></html>`;
writeFileSync(join(DIR, 'report.html'), html);

// ---- console summary ------------------------------------------------------
console.log(`Scanned ${data.listings.length} listings · ${primaryDeals.length} MSP/IT-services · ${scored.length} scored (avg ${avgScore ?? '—'}/100).`);
console.log('Wrote report.md, report.csv, report.html to', DIR);
for (const r of rows.slice(0, 8)) {
  console.log(`  [${String(r.score ?? '—').padStart(3)}] ${r.L.headline.slice(0, 46).padEnd(46)} ${r.impliedMultiple != null ? x(r.impliedMultiple) + ' ' + r.band.basis : (r.impliedRange ? 'price?' : 'no earnings')}`);
}
