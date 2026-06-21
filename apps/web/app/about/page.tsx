import type { Metadata } from 'next';
import { Creature } from '../(marketing)/Creature';
import { Wordmark } from '../(marketing)/Wordmark';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About — Nibbin',
  description:
    'Nibbin is an AI helper for people who work for themselves — a small grove of agents that learn how you work and quietly take the busywork off your plate.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navIn}>
          <a className={styles.logo} href="/" aria-label="Nibbin home">
            <Creature species="Keeper" stage="student" color="#5B7C2E" size={34} />
            <Wordmark height={20} />
          </a>
          <div className={styles.navRight}>
            <a className={styles.navLink} href="/login">
              Login
            </a>
            <a className={styles.navCta} href="/#join">
              Join the grove
            </a>
          </div>
        </div>
      </nav>

      <header className={styles.header}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>About Nibbin</span>
          <h1 className={styles.h1}>Little helpers that grow up working for you.</h1>
          <p className={styles.tagline}>AI agents for people who work for themselves.</p>
        </div>
      </header>

      <main className={styles.body}>
        <div className={styles.wrap}>
          <h2>What Nibbin is</h2>
          <p>
            Nibbin is an AI helper made for people who work for themselves. Instead of handing you a blank box and a
            thousand things you could do, it gives you a small grove of agents — we call them Nibbins — that learn how
            you actually work and then quietly take the busywork off your plate, one task at a time. You don’t build
            them, wire them together, or babysit them. You raise them, and they grow into the job.
          </p>

          <h2>The problem we set out to solve</h2>
          <p>
            Most AI tools can do almost anything, which is exactly why they end up helping so little. They’re powerful
            and open-ended, and they leave the hard part to you: figuring out what to hand off, setting it up, and
            keeping it running over time. They’re also strangely impersonal. They rarely feel connected to you or to
            the way you run your business, and most of them have no idea what you actually do all day.
          </p>
          <p>
            Off-the-shelf agents exist, but they’re generic. Shaping one to fit your real workflows takes time, a fair
            amount of technical comfort, and ongoing maintenance that most solo owners simply don’t have to spare. So
            you’re left with a lot of capability and very little direction. You can do everything, and you still don’t
            know where to start.
          </p>
          <p>We think that’s backwards. The whole point of help is to be guided.</p>

          <h2>How Nibbin works</h2>
          <p>Nibbin understands you before it does anything for you.</p>
          <p>
            It begins by studying how you actually work. It reviews how you’ve been working recently and observes your
            day-to-day, and from that it builds a clear, plain-language map of your real workflows — your diagnosis:
            where your time goes, where the friction is, and where you stand to gain the most. You see this map for
            yourself. For a lot of people, that picture alone is the first time anyone has shown them exactly where
            their week disappears to.
          </p>
          <p>
            Only then does Nibbin suggest a few agents matched to your actual work, not a generic menu. You choose
            what each Nibbin may do — Observe, Draft, or Send. Agent School grades how accurately it has been working,
            so you always have the information to decide when to grant it more. You always see what your Nibbins are
            doing, why they are doing it, and how accurate they have been. Nothing is a black box, and nothing acts
            at the Send level until you grant it.
          </p>

          <h2>Personable, not just powerful</h2>
          <p>
            We built Nibbin to feel like something you actually want to check in on. Your agents are helpers you can
            see, each one growing through visible stages as it learns your business. They carry report cards. They
            celebrate the first time they handle something on their own. The personality isn’t decoration — it’s how
            trust becomes legible: you can look at a Nibbin and understand, at a glance, how much it has learned and
            how much it has earned. That sense of working alongside something, rather than configuring a tool, is the
            thing most AI products are missing.
          </p>

          <h2>Trust is the whole point</h2>
          <p>
            Inviting a piece of software to observe how you work is a big ask, and we treat it like one. The trust
            model is built into how Nibbin is made, not bolted on as fine print.
          </p>
          <div className={styles.box}>
            <ul>
              <li>
                <strong>What Nibbin sees stays with you.</strong> Screen observation happens locally. The captures it
                uses to understand your workflows never leave your device.
              </li>
              <li>
                <strong>Nothing acts without your say-so.</strong> Every new Nibbin starts by drafting for you; you
                decide when it may Send. Agent School grades its accuracy so you know when to grant more — and you can
                pull it back at any time.
              </li>
              <li>
                <strong>You can see, edit, and delete everything Nibbin knows</strong> about your business, in plain
                language, whenever you want.
              </li>
              <li>
                <strong>Privacy is the architecture.</strong> The product was designed from the ground up so the
                trustworthy thing and the convenient thing are the same thing.
              </li>
            </ul>
          </div>

          <h2>Who Nibbin is for</h2>
          <p>
            Nibbin is for the people running a business of one: freelancers, creatives, independent operators — anyone
            who is both the owner and the entire staff. It’s built especially for people who know AI could help them
            but have never had the time, the technical background, or a guide to make it actually work. If you’ve ever
            felt that these tools were built for engineers and not for you, Nibbin is the answer to that feeling.
          </p>
          <p>
            It’s not built to be another open-ended platform for people who want to assemble their own agents. It’s
            built to be the helper that does the understanding, the setup, and the steady work for you.
          </p>

          <h2>Why we built it</h2>
          <p>
            We started Nibbin because the most capable software in the world was arriving at the same moment that the
            people who could benefit from it most — the ones working entirely for themselves — were the least equipped
            to use it. The gap wasn’t capability. The gap was guidance, trust, and a little bit of warmth. Nibbin
            exists to close it.
          </p>

          <div className={styles.cta}>
            <h2>Raise your first helper.</h2>
            <p>We’re opening Nibbin to a small founding cohort of people who work for themselves.</p>
            <a className={styles.ctaBtn} href="/#join">
              Join the Founding Grove
            </a>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerIn}>
          <span>Nibbin, Inc.</span>
          <span>
            <a href="/">Home</a> · <a href="/login">Login</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
