import './(marketing)/landing.css';
import { Creature } from './(marketing)/Creature';
import { Grovekeeper } from '../components/grovekeeper/Grovekeeper';
import { Enhancers } from './(marketing)/Enhancers';
import { MayaDemo } from './(marketing)/MayaDemo';
import { WaitlistForm } from './(marketing)/WaitlistForm';
import { SiteNav } from './(marketing)/SiteNav';
import { SiteFooter } from './(marketing)/SiteFooter';

const SCHOOL = [
  { pill: 'ep-egg', label: 'Egg', stage: 'egg' as const, role: ['Enrolled and learning your work', 'Passively observing'] },
  { pill: 'ep-student', label: 'Student', stage: 'student' as const, role: ['Drafts for your approval', 'Accuracy building'] },
  { pill: 'ep-senior', label: 'Senior', stage: 'senior' as const, role: ['Reliable on routine work', 'You decide if it acts'] },
  { pill: 'ep-grad', label: 'Graduate', stage: 'grad' as const, role: ['Proven across its spec', 'Act with confidence'] },
];

const STEPS = [
  {
    num: 'DAY ONE',
    h: 'Hatch with the Grovekeeper',
    p: 'Answer a few plain questions about your work. The Keeper sets up your grove, connects your tools so nothing acts without your approval, and runs a scan of the last 12 months.',
    dur: 'Ten minutes to your first Nibbin',
  },
  {
    num: 'DAY ONE',
    h: 'Adopt working agents',
    p: 'The scan finds the busywork: unanswered inquiries, unpaid invoices, unsent follow-ups. The Agent Shop has Nibbins ready to take each one today, drafting for your approval within the first hour of setup.',
    dur: 'First draft within the hour',
  },
  {
    num: 'IN THE BACKGROUND',
    h: 'The Field Study',
    p: 'Two weeks of quiet observation, on your device. This is how Nibbin learns the work that never touches an API. Visible countdown, pause hotkey, and banking, health, and personal sites are never captured. Yours to start, skip, or stop.',
    dur: 'Fourteen days on your device',
  },
  {
    num: 'DAY 15',
    h: 'The full diagnosis',
    p: 'Every workflow named and measured for hours, frequency, and friction, including the work that never touches an API. New eggs hatch for what the Field Study finds.',
    dur: 'Your map, delivered',
  },
];

// One trust section: control + privacy, condensed (they used to be two
// repetitive bands). Same vocabulary as /about — track record, scope, off
// means off. Plain and direct: trust copy that sounds cute undercuts itself.
const TRUST = [
  {
    pi: 'Track record',
    h: 'Quality you can see.',
    p: 'Every Nibbin keeps a track record you can read: where it does well, where it slips, when you’ve had to step in. Correct it once and it learns. No agent gets to vouch for itself.',
  },
  {
    pi: 'Scope',
    h: 'You decide what it can touch.',
    p: 'Permissions start narrow, and you set them. A Nibbin earns more room only by proving it handles what it already has, and nothing sends, books, or pays until you allow it. You can pull that room back anytime.',
  },
  {
    pi: 'On your device',
    h: 'Watched only if you allow it.',
    p: 'The screen capture Nibbin learns from never leaves your device. We never sell your data, you can opt out in settings anytime, and off means off.',
  },
];

const PRICING = [
  {
    tier: 'Hatchling (Free)',
    feat: false,
    cta: 'Start free',
    items: ['Full 14-day Field Study + diagnosis', '2 Nibbins · 100 actions / month', 'The Grovekeeper + 12-month scan', 'All privacy guarantees, always'],
  },
  {
    tier: 'Grove',
    feat: true,
    cta: 'Join the waitlist',
    items: ['Up to 5 Nibbins', '1,000 actions / month', 'Agent School graduation + full run logs', 'Re-diagnosis on demand'],
  },
  {
    tier: 'Canopy',
    feat: false,
    cta: 'Join the waitlist',
    items: ['Unlimited Nibbins', '5,000 actions / month', 'Credit top-ups available', 'Priority support'],
  },
];

export default function Home() {
  return (
    <main className="landing" id="top">
      <Enhancers />

      <SiteNav home />

      <header className="hero">
        <div className="hero-leaves" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">AI Agents. Simplified.</span>
            <h1>
              Little helpers that <em>grow up</em> working for you.
            </h1>
            <p className="lede">
              Hatch your first Nibbin in minutes. The Grovekeeper connects your tools, scans for busywork, and
              staffs it with small helpers that learn your way of doing things. You decide what each Nibbin may
              do: Observe, Draft, or Act. Agent School grades how well it is doing, so you always know when to
              extend more trust. A two-week Field Study runs in the background to deepen the initial mapping into a full
              diagnosis.
            </p>
            <div className="cta-row">
              <a className="btn btn-solid" href="#join">
                Join the Founding Grove
              </a>
              <a className="btn btn-ghost" href="#how">
                How Agent School works
              </a>
            </div>
            <p className="hero-note">
              First agent in 10 minutes. Free to start.
              <br />
              <b>Screen captures never leave your device</b>
            </p>
          </div>
          <div className="evocard">
            <span className="t">Your Nibbin&apos;s Agent School report card</span>
            <svg className="evo-vine" viewBox="0 0 400 14" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M8 9 C70 1 120 13 200 7 C280 1 330 12 392 6"
                fill="none"
                stroke="#9CC25B"
                strokeWidth="2"
                strokeLinecap="round"
                opacity=".55"
                strokeDasharray="3 5"
              />
              <circle cx="8" cy="9" r="2.4" fill="#9CC25B" />
              <circle cx="200" cy="7" r="2.4" fill="#9CC25B" />
              <circle cx="392" cy="6" r="2.4" fill="#9CC25B" />
            </svg>
            <div className="evo-track">
              {SCHOOL.map((s) => (
                <div className="evo-stop" key={s.label}>
                  <span className={`evo-pill ${s.pill}`}>{s.label}</span>
                  <Creature species="Sprout" stage={s.stage} color="#5B7C2E" size={52} />
                  <span className="role">
                    <b>{s.role[0]}</b>
                    <br />
                    {s.role[1]}
                  </span>
                </div>
              ))}
            </div>
            <div className="evo-meter">
              <span className="lbl">PROMOTION RULE</span>
              <div className="bar">
                <i style={{ width: '95%' }}></i>
              </div>
              <span className="val">≥95% verified accuracy over 25 real runs</span>
            </div>
            <div className="cap">
              Nibbins grow on <b>accuracy you’ve verified</b>, never on time served.
            </div>
          </div>
        </div>
      </header>

      <section id="how">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">The method</span>
            <h2>Your first agent in 10 minutes. Smarter by day fifteen.</h2>
            <p>
              Most tools make you wait or make you configure. Nibbin does neither: the Grovekeeper puts agents to
              work on day one, while your Field Study builds the deeper map.
            </p>
          </div>
          <div className="steps reveal">
            {STEPS.map((s) => (
              <div className="step" key={s.h}>
                <span className="num">{s.num}</span>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
                <span className="dur">{s.dur}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="keeper"
        style={{ background: '#EFF4E4', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="wrap">
          <div className="keeper-grid reveal">
            <div className="keeper-art">
              <Grovekeeper size={200} />
              <span className="keeper-tag">THE GROVEKEEPER</span>
            </div>
            <div>
              <span className="eyebrow">Your guide</span>
              <h2 style={{ fontFamily: 'var(--display)', fontWeight: 800, letterSpacing: '-.015em', margin: '8px 0 10px' }}>
                Meet the Grovekeeper.
              </h2>
              <p style={{ color: 'var(--ink-soft)', maxWidth: '56ch' }}>
                The elder of the grove runs your setup, your scan, and your daily check-ins, and explains every
                recommendation in plain language, including what it costs and what it touches.
              </p>
              <div className="keeper-points">
                <div className="kp">
                  <b>Sets you up in minutes.</b> A short conversation, not a configuration screen. The Keeper hatches
                  your first Nibbin and connects your tools, and nothing acts until you approve it.
                </div>
                <div className="kp">
                  <b>Finds the busywork.</b> It looks at your past work across connected applications, names what it
                  finds in hours and dollars, and introduces the Nibbin for each job.
                </div>
                <div className="kp">
                  <b>Orchestrates and delegates.</b> The Keeper can never send, post, pay, or delete. It explains each
                  recommendation; only Nibbins you’ve approved do the work, at the action level you’ve set.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Interactive demo with a fictional client</span>
            <h2>Maya’s Grove</h2>
            <p>
              Maya Reyes is a wedding photographer. Her study ended three weeks ago, and her four Nibbins are at four
              different grades of Agent School. Click around. Everything responds.
            </p>
          </div>
          <div className="reveal">
            <MayaDemo />
          </div>
        </div>
      </section>

      <section id="trust">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Trust &amp; control</span>
            <h2>You stay in control.</h2>
            <p>
              Handing your work to software is a real ask. We built Nibbin so the careful choice and the easy
              choice are the same one. You can see what every agent does, you set what it may touch, and what it
              learns from never leaves your machine.
            </p>
          </div>
          <div className="priv-grid reveal">
            {TRUST.map((c) => (
              <div className="pcard" key={c.h}>
                <span className="pi">{c.pi}</span>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </div>
            ))}
          </div>
          <p className="priv-foot ctrl-foot">
            <a href="/about">How this works → /about</a>
          </p>
        </div>
      </section>

      <section id="pricing">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Simple, honest pricing</span>
            <h2>The diagnosis is free. Pay as your grove grows.</h2>
            <p>
              See your full workflow map and two-week study before you pay a cent. An action is one completed task, and
              the meter is always visible in the grove, with no surprise bills and never silent degradation.
            </p>
          </div>
          <div className="price-grid reveal">
            {PRICING.map((p) => (
              <div className={`price${p.feat ? ' feat' : ''}`} key={p.tier}>
                <span className="tier">{p.tier}</span>
                <ul>
                  {p.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
                <a className="btn btn-solid" href="#join">
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="join">
        <div className="wrap">
          <div className="join-card reveal">
            <Creature species="Wisp" stage="egg" color="#7B5BD6" size={88} />
            <span className="eyebrow">100 seats</span>
            <h2>Join the Founding Grove.</h2>
            <p className="sub">
              We’re opening Nibbin to a small first cohort of people who work for themselves. Claim a seat and the
              Grovekeeper will hatch your first Nibbins early, and personally.
            </p>
            <WaitlistForm />
            <p className="join-note">Double opt-in. One confirmation email. Unsubscribe anytime.</p>
          </div>
        </div>
      </section>

      <SiteFooter home />
    </main>
  );
}
