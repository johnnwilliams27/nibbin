'use client';

import { useState } from 'react';
import type { Accessory, Marking, SpeciesName, Stage } from '@nibbin/creatures';
import { Creature } from './Creature';
import './demo.css';

type TabId = 'today' | 'map' | 'agents' | 'shop' | 'build';

const TABS: { id: TabId; label: string }[] = [
  { id: 'today', label: 'TODAY' },
  { id: 'map', label: 'YOUR MAP' },
  { id: 'agents', label: 'YOUR NIBBINS' },
  { id: 'shop', label: 'AGENT SHOP' },
  { id: 'build', label: 'HATCH YOUR OWN' },
];

interface WF {
  id: string;
  x: number;
  y: number;
  r: number;
  name: string;
  hrs: string;
  freq: string;
  apps: string;
  auto: number;
  color: string;
  friction: string;
}
const WORKFLOWS: WF[] = [
  { id: 'edit', x: 160, y: 120, r: 34, name: 'Culling & editing', hrs: '11.2', freq: '4×/week', apps: 'Lightroom · Photo Mechanic', auto: 35, color: '#D9A21B', friction: 'The export → rename → resize → re-export loop after editing is pure repetition: 41 identical runs observed. The creative work stays yours; the file plumbing doesn’t have to.' },
  { id: 'email', x: 250, y: 190, r: 28, name: 'Client email & inquiries', hrs: '6.8', freq: 'daily', apps: 'Gmail', auto: 70, color: '#5B7C2E', friction: '71% of inbound asks one of 12 questions (pricing, availability, what’s included). You typed near-identical replies 64 times in two weeks. This is Scout’s whole job.' },
  { id: 'album', x: 95, y: 275, r: 25, name: 'Album design & revisions', hrs: '4.5', freq: '2×/week', apps: 'AlbumStomp · Gmail', auto: 20, color: '#D9A21B', friction: 'Design is judgment work — low automation. But revision-round emails and version tracking ate 50 minutes/week of it.' },
  { id: 'gallery', x: 420, y: 105, r: 21, name: 'Gallery delivery', hrs: '3.1', freq: '3×/week', apps: 'Pixieset · Finder · Gmail', auto: 85, color: '#E2603A', friction: 'Your single biggest friction-per-hour: an 11-step chain done identically 39 times, with two forgotten delivery emails caught days late. Lily graduated on exactly this.' },
  { id: 'invoice', x: 430, y: 255, r: 19, name: 'Invoicing & contracts', hrs: '2.4', freq: 'weekly', apps: 'HoneyBook · QuickBooks', auto: 80, color: '#5B7C2E', friction: 'Three invoices went out late in the study window; one payment nudge was skipped entirely. Rule-based, calendar-driven — Penny’s curriculum.' },
  { id: 'sched', x: 280, y: 300, r: 18, name: 'Scheduling & reminders', hrs: '2.2', freq: 'daily', apps: 'Calendly · Gmail', auto: 75, color: '#5B7C2E', friction: 'Confirmations, prep guides, and week-of reminders are template emails you assemble by hand each time. Dot enrolled for this today.' },
];

interface Agent {
  name: string;
  job: string;
  sp: SpeciesName;
  mk: Marking;
  stage: Stage;
  acc: Accessory;
  stageLabel: string;
  cls: string;
  color: string;
  rung: number;
  desc: string;
  metric: string;
  learned: string;
  streak: string | null;
  badges: [string, boolean][];
  action: string;
  go: boolean;
}
const AGENTS: Agent[] = [
  { name: 'Lily', job: 'Gallery delivery', sp: 'Sprout', mk: 'star', stage: 'grad', acc: 'none', stageLabel: 'GRADUATE', cls: 'st-grad', color: '#5B7C2E', rung: 4, desc: 'Runs Maya’s 11-step gallery chain whenever an export lands: rename, resize, upload, build the gallery, send the delivery email. Graduated March 28.', metric: '17 deliveries · 0 interventions', learned: 'You like delivery emails to land before 9 AM — she holds finished galleries overnight and sends at 7:40.', streak: '17-run clean streak', badges: [['First Solo', true], ['Zero-Miss Month', true], ['100 Runs', false]], action: 'View run log (17)', go: false },
  { name: 'Scout', job: 'Inquiries & replies', sp: 'Longear', mk: 'none', stage: 'senior', acc: 'pencil', stageLabel: 'SENIOR', cls: 'st-senior', color: '#3E7C74', rung: 3, desc: 'Drafts replies to incoming inquiries using Maya’s packages and calendar. Routine questions go out on standing approval; anything new gets flagged, not guessed.', metric: '94% match · 23 runs · 2 from graduating', learned: 'Repeat clients get a warmer opening line — he picked that up from your edits in week one.', streak: '9-day streak', badges: [['First Draft', true], ['20 Runs', true], ['First Solo', false]], action: 'Review & graduate →', go: true },
  { name: 'Penny', job: 'Invoices & nudges', sp: 'Glim', mk: 'none', stage: 'student', acc: 'coin', stageLabel: 'STUDENT', cls: 'st-student', color: '#D9A21B', rung: 2, desc: 'Drafts every invoice after a shoot from contract terms, and friendly nudges when payments slip. Right now you approve everything — that’s how she learns your tone.', metric: '88% match · 9 runs · 2 drafts waiting in Today', learned: 'You waive late fees for past clients — so she asks you instead of ever adding one.', streak: '4-day streak', badges: [['First Draft', true], ['20 Runs', false]], action: 'See her drafts', go: false },
  { name: 'Dot', job: 'Reminders & confirmations', sp: 'Puff', mk: 'none', stage: 'egg', acc: 'none', stageLabel: 'EGG · ENROLLED TODAY', cls: 'st-egg', color: '#E2603A', rung: 1, desc: 'Will handle booking confirmations, prep guides, and week-of reminders. For now: just watching how you do it. First drafts expected in 3–4 days.', metric: 'Watching · 0 drafts yet', learned: 'Still observing. Nibbins don’t guess before they’ve watched.', streak: null, badges: [['Enrolled', true], ['First Draft', false]], action: 'What is Dot learning?', go: false },
];

interface Shop {
  name: string;
  job: string;
  sp: SpeciesName;
  color: string;
  acc: Accessory;
  desc: string;
}
const SHOP: Shop[] = [
  { name: 'Sweep', job: 'Inbox tidier', sp: 'Wisp', color: '#5B8BD6', acc: 'broom', desc: 'Labels what matters, archives what doesn’t, drafts the easy replies, and unsubscribes you from the junk you never read.' },
  { name: 'Tally', job: 'Receipt wrangler', sp: 'Capling', color: '#C98A12', acc: 'coin', desc: 'Catches receipts from email and downloads, files them by client and category, and hands your bookkeeper a clean folder monthly.' },
  { name: 'Echo', job: 'Follow-up', sp: 'Glim', color: '#3E7C74', acc: 'bow', desc: 'Watches for sent emails that never got a reply and drafts the polite bump at the right interval — your wording, your cadence.' },
  { name: 'Brief', job: 'Morning briefer', sp: 'Longear', color: '#7B5BD6', acc: 'glasses', desc: 'Reads your calendar and threads at dawn and leaves one short note: who you’re seeing, what’s open, what needs deciding today.' },
  { name: 'Hopper', job: 'Form filler', sp: 'Puff', color: '#E2603A', acc: 'none', desc: 'Fills the portals and forms you do on repeat — same fields, different day — and pauses for your check before anything submits.' },
  { name: 'Scribe', job: 'Paper chaser', sp: 'Sprout', color: '#5A6248', acc: 'quill', desc: 'Sends contracts for signature, tracks who hasn’t signed, nudges them gently, and files the finished copy where you keep them.' },
];

const CHORES = [
  ['Answering the same emails over and over', 'replies, quotes, FAQs'],
  ['Chasing people who haven’t paid or replied', 'invoices, follow-ups, nudges'],
  ['Moving files and info between apps', 'export → rename → upload → notify'],
  ['Keeping clients in the loop', 'confirmations, reminders, updates'],
];
const APPS = ['Gmail', 'Outlook', 'Google Calendar', 'QuickBooks', 'HoneyBook', 'Stripe', 'Drive / Dropbox', 'Notion'];

export function MayaDemo() {
  const [tab, setTab] = useState<TabId>('today');
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [selWF, setSelWF] = useState('gallery');
  const [graduatedQueued, setGraduatedQueued] = useState<Record<string, boolean>>({});
  const [adopted, setAdopted] = useState<Record<string, boolean>>({});

  // wizard
  const [step, setStep] = useState(1);
  const [chore, setChore] = useState<number | null>(null);
  const [apps, setApps] = useState<Set<string>>(new Set());
  const [eggName, setEggName] = useState('');
  const [enrolled, setEnrolled] = useState(false);

  const w = WORKFLOWS.find((x) => x.id === selWF)!;

  return (
    <div className="demo-shell">
      <div className="demo-bar">
        <div className="dots">
          <span />
          <span />
          <span />
        </div>
        <span className="crumb">
          <b>nibbin</b> / maya-reyes / the-grove
        </span>
      </div>
      <div className="demo-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`demo-tab${tab === t.id ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== TODAY ===== */}
      {tab === 'today' && (
        <div className="demo-pane">
          <div className="chipline">
            <div className="item">
              THURSDAY<b>April 16</b>
            </div>
            <div className="item">
              TIME SAVED TODAY<b className="moss">1h 12m</b>
            </div>
            <div className="item">
              THIS WEEK<b className="moss">6.4 hrs</b>
            </div>
            <div className="item">
              NEEDS YOUR EYES<b className="coral">3 items</b>
            </div>
          </div>
          <div className="today-grid">
            <div>
              <div className="tcard todo" style={{ marginBottom: 18 }}>
                <h4>Needs you — your only to-do</h4>
                {[
                  { id: 'q1', who: { stage: 'student' as Stage, sp: 'Glim' as SpeciesName, c: '#D9A21B', acc: 'coin' as Accessory }, what: <><b>Penny</b> drafted invoice #2041 — Chen/Okafor wedding · $3,850 · net-14 per contract</>, meta: 'drafted 2h ago · matches contract terms · attachment ready', ok: 'Approve & send', msg: 'Penny is one approval closer to Senior 🎓', edit: 'Edit first' },
                  { id: 'q2', who: { stage: 'student' as Stage, sp: 'Glim' as SpeciesName, c: '#D9A21B', acc: 'coin' as Accessory }, what: <><b>Penny</b> drafted a payment nudge — Rivera engagement shoot · $620 · 9 days overdue</>, meta: 'friendly tone — she remembered you waive late fees for repeat clients, so she asked instead of charging one', ok: 'Approve & send', msg: 'Sent. Penny noted you kept her wording.', edit: 'Edit first' },
                  { id: 'q3', who: { stage: 'senior' as Stage, sp: 'Longear' as SpeciesName, c: '#3E7C74', acc: 'pencil' as Accessory }, what: <><b>Scout</b> flagged an inquiry it hasn’t seen before — a commercial brand shoot</>, meta: 'Outside Scout’s training — it drafted a holding reply and is asking, not guessing', ok: 'Send holding reply', msg: 'Reply sent. Scout filed this as a new example to learn from.', edit: 'Write my own' },
                ].map((q) => (
                  <div className="feed-item" key={q.id}>
                    <div className="who">
                      <Creature stage={q.who.stage} species={q.who.sp} color={q.who.c} acc={q.who.acc} size={46} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="what">{q.what}</div>
                      <div className="meta">{q.meta}</div>
                      {approved[q.id] ? (
                        <div className="qdone">✓ {approved[q.id]}</div>
                      ) : (
                        <div className="qbtns">
                          <button className="qbtn ok" onClick={() => setApproved((a) => ({ ...a, [q.id]: q.msg }))}>
                            {q.ok}
                          </button>
                          <button className="qbtn edit">{q.edit}</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="tcard" style={{ marginBottom: 18 }}>
                <h4>Done while you were editing</h4>
                <Feed stage="grad" sp="Sprout" c="#5B7C2E" what={<><b>Lily</b> delivered the Harper/Nguyen gallery — exported, uploaded, client emailed</>} meta={<>7:42 AM · 11 steps · <b>saved 38 min</b></>} />
                <Feed stage="senior" sp="Longear" c="#3E7C74" acc="pencil" what={<><b>Scout</b> answered 6 inquiries — 5 sent on your standing approval, 1 flagged (left)</>} meta={<>throughout the morning · <b>saved 34 min</b></>} />
                <Feed stage="egg" sp="Puff" c="#E2603A" what={<><b>Dot</b> enrolled in Agent School today — quietly watching how you handle reminders</>} meta="first drafts expected in 3–4 days" />
              </div>
              <div className="tcard">
                <h4>Coming up</h4>
                <Feed stage="grad" sp="Sprout" c="#5B7C2E" what={<><b>Lily</b> will deliver the Park proposal gallery when your export lands</>} meta="Waiting on you · usually Fridays" />
                <Feed stage="senior" sp="Longear" c="#3E7C74" acc="pencil" what={<><b>Scout</b> is 2 approved drafts from graduating</>} meta="94% match over 23 runs · threshold: 95% over 25" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MAP ===== */}
      {tab === 'map' && (
        <div className="demo-pane">
          <div className="chipline">
            <div className="item">STUDY WINDOW<b>Mar 2 – Mar 15</b></div>
            <div className="item">DESKTOP WORK OBSERVED<b>47.5 hrs/wk</b></div>
            <div className="item">WORKFLOWS FOUND<b>6</b></div>
            <div className="item">AUTOMATABLE<b className="moss">13.9 hrs/wk</b></div>
            <div className="item">BIGGEST FRICTION<b className="coral">Gallery delivery</b></div>
          </div>
          <div className="map-grid">
            <div className="map-canvas">
              <svg viewBox="0 0 560 360" aria-label="Map of Maya's six workflows sized by weekly hours">
                <g fill="none" stroke="#D6DAC8" strokeWidth="1.4">
                  <path d="M95,275 C150,255 180,200 250,190" />
                  <path d="M250,190 C320,180 350,120 420,105" />
                  <path d="M250,190 C290,230 350,250 430,255" />
                  <path d="M95,275 C120,300 200,310 280,300" />
                  <path d="M160,120 C200,140 220,165 250,190" />
                </g>
                <g fontFamily="var(--mono)">
                  {WORKFLOWS.map((n) => (
                    <g
                      key={n.id}
                      className={`wf-node${selWF === n.id ? ' sel' : ''}`}
                      onClick={() => setSelWF(n.id)}
                      role="button"
                      aria-label={n.name}
                    >
                      <circle className="halo" cx={n.x} cy={n.y} r={n.r + 10} />
                      <circle className="core" cx={n.x} cy={n.y} r={n.r} fill="#FFFFFF" stroke={n.color} strokeWidth="2" />
                      <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={n.color}>
                        {n.hrs}
                      </text>
                      <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fontSize="9" fill="#5A6248">
                        {n.name.split(' & ')[0].toLowerCase()}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
              <div className="map-legend">
                <span className="key">
                  <i style={{ background: '#5B7C2E' }} />
                  highly automatable
                </span>
                <span className="key">
                  <i style={{ background: '#D9A21B' }} />
                  partly automatable
                </span>
                <span className="key">
                  <i style={{ background: '#E2603A' }} />
                  friction hotspot
                </span>
                <span className="key">○ size = hours/week</span>
              </div>
            </div>
            <div className="detail">
              <span className="eyebrow">WORKFLOW {String(WORKFLOWS.indexOf(w) + 1).padStart(2, '0')} / 06</span>
              <h3>{w.name}</h3>
              <div className="apps">{w.apps}</div>
              <div className="stat-row">
                <div className="stat">
                  <div className="l">Hours/wk</div>
                  <div className="v">{w.hrs}</div>
                </div>
                <div className="stat">
                  <div className="l">Frequency</div>
                  <div className="v">{w.freq}</div>
                </div>
                <div className="stat">
                  <div className="l">Automatable</div>
                  <div className="v moss">{w.auto}%</div>
                </div>
              </div>
              <div className="autobar">
                <i style={{ width: `${w.auto}%` }} />
              </div>
              <div className="friction">
                <div className="fl">What the study found</div>
                <p>{w.friction}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== AGENTS ===== */}
      {tab === 'agents' && (
        <div className="demo-pane">
          <div className="roster">
            {AGENTS.map((a) => (
              <div className="agent" key={a.name}>
                <div className="top">
                  <Creature stage={a.stage} species={a.sp} color={a.color} acc={a.acc} mark={a.mk} size={58} />
                  <div className="id">
                    <h4>{a.name}</h4>
                    <div className="job">{a.job}</div>
                  </div>
                  <span className={`stagepill ${a.cls}`}>{a.stageLabel}</span>
                </div>
                <div className="school">
                  <div className="lbl">
                    <span>AGENT SCHOOL</span>
                    <b>{a.metric}</b>
                  </div>
                  <div className="ladder">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className={`rung${i < a.rung ? ' done' : i === a.rung ? ' cur' : ''}`} />
                    ))}
                  </div>
                  <div className="ladder-names">
                    <span>Egg</span>
                    <span>Student</span>
                    <span>Senior</span>
                    <span>Graduate</span>
                  </div>
                </div>
                <p className="desc">{a.desc}</p>
                <div className="learned">
                  <div className="ll">What {a.name} has learned about you</div>
                  <p>{a.learned}</p>
                </div>
                <div className="badge-row">
                  {a.streak && <span className="streak">{a.streak}</span>}
                  {a.badges.map(([b, earned]) => (
                    <span key={b} className={`badge${earned ? ' earned' : ''}`} title={earned ? 'Earned' : 'Not yet earned'}>
                      {b}
                    </span>
                  ))}
                </div>
                <div className="foot">
                  <span className="m">
                    Access: <b>draft-only until graduation</b>
                  </span>
                  <button
                    className={`abtn${a.go && !graduatedQueued[a.name] ? ' go' : ''}`}
                    onClick={() => a.go && setGraduatedQueued((g) => ({ ...g, [a.name]: true }))}
                  >
                    {graduatedQueued[a.name] ? '✓ Graduation queued — 2 runs to go' : a.action}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== SHOP ===== */}
      {tab === 'shop' && (
        <div className="demo-pane">
          <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 18 }}>
            Ready-made Nibbins anyone can adopt — no study required. They enroll as eggs and climb Agent School the same
            way your custom ones do.
          </p>
          <div className="shop-grid">
            {SHOP.map((s) => (
              <div className="shop-card" key={s.name}>
                <Creature stage="senior" species={s.sp} color={s.color} acc={s.acc} size={60} />
                <h4>{s.name}</h4>
                <div className="job">{s.job}</div>
                <p>{s.desc}</p>
                <button className={`abtn${adopted[s.name] ? '' : ' go'}`} onClick={() => setAdopted((d) => ({ ...d, [s.name]: true }))}>
                  {adopted[s.name] ? `✓ ${s.name} enrolled as an egg` : 'Adopt into my grove'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== BUILD ===== */}
      {tab === 'build' && (
        <div className="demo-pane">
          <div className="wiz">
            <div className="wiz-steps">
              {[1, 2, 3].map((i) => (
                <div key={i} className={`wiz-step-ind${i <= step ? ' on' : ''}`} />
              ))}
            </div>

            {step === 1 && (
              <div className="wiz-pane active">
                <h3>What’s the chore?</h3>
                <p className="sub">Pick the thing you’re tired of doing. Plain words are fine — no flowcharts, no settings.</p>
                <div className="chore-grid">
                  {CHORES.map(([c, small], i) => (
                    <button key={c} className={`chore${chore === i ? ' sel' : ''}`} onClick={() => setChore(i)}>
                      {c}
                      <small>{small}</small>
                    </button>
                  ))}
                </div>
                <div className="wiz-nav">
                  <span />
                  <button className="btn btn-solid" disabled={chore === null} style={{ opacity: chore === null ? 0.4 : 1 }} onClick={() => setStep(2)}>
                    Next →
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="wiz-pane active">
                <h3>Where does it happen?</h3>
                <p className="sub">Tap the apps involved. Your Nibbin only ever gets the narrowest access that works — you set its action level (Observe, Draft, or Send) after it hatches.</p>
                <div className="appsel">
                  {APPS.map((a) => (
                    <button
                      key={a}
                      className={`apptag${apps.has(a) ? ' sel' : ''}`}
                      onClick={() =>
                        setApps((s) => {
                          const n = new Set(s);
                          if (n.has(a)) n.delete(a);
                          else n.add(a);
                          return n;
                        })
                      }
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="wiz-nav">
                  <button className="btn btn-ghost" onClick={() => setStep(1)}>
                    ← Back
                  </button>
                  <button className="btn btn-solid" disabled={apps.size === 0} style={{ opacity: apps.size === 0 ? 0.4 : 1 }} onClick={() => setStep(3)}>
                    Next →
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="wiz-pane active">
                <div className="hatch">
                  <h3>Your egg is ready.</h3>
                  <p className="sub">It already knows the chore and the apps. Give it a name — that’s the whole setup.</p>
                  <div style={{ margin: '6px 0 4px' }}>
                    <Creature stage="egg" species="Wisp" color="#7B5BD6" size={84} />
                  </div>
                  <div className="nameline">
                    <input
                      type="text"
                      placeholder="Name your Nibbin…"
                      maxLength={14}
                      value={eggName}
                      disabled={enrolled}
                      onChange={(e) => setEggName(e.target.value)}
                      aria-label="Name your Nibbin"
                    />
                    <button className="btn btn-solid" disabled={eggName.trim().length === 0 || enrolled} style={{ opacity: eggName.trim().length === 0 || enrolled ? 0.4 : 1 }} onClick={() => setEnrolled(true)}>
                      {enrolled ? '✓ Enrolled' : 'Enroll in Agent School'}
                    </button>
                  </div>
                  <p className="note">It starts as an egg: watching only. In a few days it hatches into a student and begins drafting work for your approval. You set its action level — Observe, Draft, or Send — and Agent School grades how accurately it handles the chore.</p>
                  {enrolled && (
                    <div className="enrolled">
                      🎒 <b>{eggName.trim() || 'Nib'}</b> is enrolled in Agent School. It&apos;s watching how you handle this
                      chore now — expect its first drafts in your Today feed within a few days.
                    </div>
                  )}
                </div>
                <div className="wiz-nav">
                  <button className="btn btn-ghost" onClick={() => setStep(2)}>
                    ← Back
                  </button>
                  <span />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="demo-disclaimer">Interactive demo · fictional client · everything responds.</p>
    </div>
  );
}

function Feed({
  stage,
  sp,
  c,
  acc = 'none',
  what,
  meta,
}: {
  stage: Stage;
  sp: SpeciesName;
  c: string;
  acc?: Accessory;
  what: React.ReactNode;
  meta: React.ReactNode;
}) {
  return (
    <div className="feed-item">
      <div className="who">
        <Creature stage={stage} species={sp} color={c} acc={acc} size={46} />
      </div>
      <div>
        <div className="what">{what}</div>
        <div className="meta">{meta}</div>
      </div>
    </div>
  );
}
