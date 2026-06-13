import './(marketing)/landing.css';
import { Creature } from './(marketing)/Creature';
import { Enhancers } from './(marketing)/Enhancers';
import { MayaDemo } from './(marketing)/MayaDemo';
import { WaitlistForm } from './(marketing)/WaitlistForm';
import { Wordmark } from './(marketing)/Wordmark';

const SCHOOL = [
  { pill: 'ep-egg', label: 'Egg', stage: 'egg' as const, role: ['Enrolled', 'learning your style'] },
  { pill: 'ep-student', label: 'Student', stage: 'student' as const, role: ['Drafts only', 'you approve every send'] },
  { pill: 'ep-senior', label: 'Senior', stage: 'senior' as const, role: ['Sends the routine', 'exceptions come to you'] },
  { pill: 'ep-grad', label: 'Graduate', stage: 'grad' as const, role: ['Works alone', 'every run logged'] },
];

const STEPS = [
  {
    num: 'DAY ONE',
    h: 'Hatch with the Grovekeeper',
    p: 'Answer a few plain questions about your work. The Keeper sets up your grove, connects your tools read-only, and runs a scan of the last 90 days.',
    dur: '10 minutes, start to first Nibbin',
  },
  {
    num: 'DAY ONE',
    h: 'Adopt working agents',
    p: 'The scan finds the busywork — unanswered inquiries, unpaid invoices, unsent follow-ups — and the Agent Shop has Nibbins ready to take each one today, drafting for your approval from the first hour.',
    dur: 'first draft within the hour',
  },
  {
    num: 'IN THE BACKGROUND',
    h: 'The Field Study',
    p: 'Two weeks of quiet observation, on your device — how Nibbin learns the work that never touches an API. Visible countdown, pause hotkey; banking, health, and personal sites are never captured. Yours to start, skip, or stop.',
    dur: '14 days · on your device',
  },
  {
    num: 'DAY 15',
    h: 'The full diagnosis',
    p: 'Every workflow named and measured — hours, frequency, friction — including the work that never touches an API. New eggs hatch for what the Field Study finds.',
    dur: 'your map, delivered',
  },
];

const PRIVACY = [
  {
    pi: 'On your device',
    h: 'Screen captures never leave',
    p: 'The Field Study runs locally. Raw captures are processed and deleted on your machine — only redacted, structured text about your workflows is ever uploaded, and only when you say so.',
  },
  {
    pi: 'Read-only by default',
    h: 'Nothing sends without you',
    p: 'Connections start read-only. A Nibbin earns the ability to send, per task, only after you grant it — and even then, its accuracy was verified on drafts you approved first.',
  },
  {
    pi: 'Yours to control',
    h: 'Your data stays yours',
    p: 'We never sell your data. We use it to make Nibbin better, and you can opt out anytime in settings. Either way, your screen captures never leave your device.',
  },
];

const PRICING = [
  {
    tier: 'Hatchling — Free',
    feat: false,
    cta: 'Start free',
    items: ['Full 14-day Field Study + diagnosis', '2 Nibbins · 100 actions / month', 'The Grovekeeper + 90-day scan', 'All privacy guarantees, always'],
  },
  {
    tier: 'Grove',
    feat: true,
    cta: 'Join the waitlist',
    items: ['Up to 5 Nibbins', '1,000 actions / month', 'Agent School graduation + full run logs', 'Quarterly re-diagnosis'],
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

      <nav>
        <div className="wrap nav-in">
          <a className="logo" href="#top" aria-label="Nibbin home">
            <Creature species="Keeper" stage="student" color="#5B7C2E" size={38} className="cr" />
            <Wordmark height={22} />
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#demo">Live demo</a>
            <a href="#privacy">Privacy</a>
            <a href="#pricing">Pricing</a>
          </div>
          <a className="nav-cta" href="#join">
            Join the grove
          </a>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-leaves" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">AI agents for creative freelancers</span>
            <h1>
              Little creatures that <em>grow up</em> working for you.
            </h1>
            <p className="lede">
              Hatch your first Nibbin in minutes. The Grovekeeper connects your tools, scans for busywork, and
              staffs it with small creatures that learn your way of doing things, earn your trust draft by draft,
              and graduate to handling the boring parts for real. A two-week Field Study runs quietly alongside and
              deepens the map into a full diagnosis.
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
              First agent in 10 minutes · Free to start
              <br />
              <b>Screen captures never leave your device</b>
            </p>
          </div>
          <div className="evocard">
            <span className="t">Agent School — every Nibbin earns its way up</span>
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
                    <b>{s.role[0]}</b> —<br />
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
              Nibbins grow on <b>accuracy you’ve verified</b>, never on time served. Any graduate can be sent back a
              grade with one click — demotion is one tap, dignity intact.
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
              work on day one, while an optional study quietly builds the deeper map.
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
              <Creature species="Keeper" size={190} />
              <span className="keeper-tag">THE GROVEKEEPER · same in every grove</span>
            </div>
            <div>
              <span className="eyebrow">Your guide</span>
              <h2 style={{ fontFamily: 'var(--display)', fontWeight: 800, letterSpacing: '-.015em', margin: '8px 0 10px' }}>
                Meet the Grovekeeper.
              </h2>
              <p style={{ color: 'var(--ink-soft)', maxWidth: '56ch' }}>
                The elder of the grove runs your setup, your scan, and your daily check-ins — and explains every
                recommendation in plain language, including what it costs and what it touches.
              </p>
              <div className="keeper-points">
                <div className="kp">
                  <b>Sets you up in minutes.</b> A short conversation, not a configuration screen. The Keeper hatches
                  your grove and connects your tools — read-only until you say otherwise.
                </div>
                <div className="kp">
                  <b>Finds the busywork.</b> It runs the 90-day scan, names what it finds in hours and dollars, and
                  introduces the Nibbin for each job.
                </div>
                <div className="kp">
                  <b>Has no hands — by design.</b> The Keeper can never send, post, pay, or delete. It explains and
                  delegates; only Nibbins you’ve approved do work, at the trust level they’ve earned.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Interactive demo · fictional client</span>
            <h2>Maya’s grove</h2>
            <p>
              Maya Reyes is a wedding photographer. Her study ended three weeks ago, and her four Nibbins are at four
              different grades of Agent School. Click around — everything responds.
            </p>
          </div>
          <div className="reveal">
            <MayaDemo />
          </div>
        </div>
      </section>

      <section id="privacy">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Privacy by architecture</span>
            <h2>The careful kind of AI.</h2>
            <p>
              Solo owners fear two things about AI: that it embarrasses them in front of clients, and that it
              watches everything. Both answers are built in, not bolted on.
            </p>
          </div>
          <div className="priv-grid reveal">
            {PRIVACY.map((c) => (
              <div className="pcard" key={c.h}>
                <span className="pi">{c.pi}</span>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </div>
            ))}
          </div>
          <p className="priv-foot">Full detail in the data &amp; AI overview and privacy policy — published at launch.</p>
        </div>
      </section>

      <section id="pricing">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="eyebrow">Simple, honest pricing</span>
            <h2>The diagnosis is free. Pay as your grove grows.</h2>
            <p>
              See your full workflow map and two-week study before you pay a cent. An action is one completed task; the
              meter is always visible in the grove — no surprise bills, never silent degradation.
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
              Grovekeeper will hatch your grove early — and personally.
            </p>
            <WaitlistForm />
            <p className="join-note">Double opt-in · one confirmation email · unsubscribe anytime.</p>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-in">
          <span>© 2026 Nibbin · hello@nibbin.com</span>
          <div className="foot-links">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="mailto:hello@nibbin.com">Contact</a>
            <span className="soon" title="Available at launch">
              Privacy
            </span>
            <span className="soon" title="Available at launch">
              Terms
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
