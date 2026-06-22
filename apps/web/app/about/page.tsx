import type { Metadata } from 'next';
import '../(marketing)/landing.css';
import '../(marketing)/about.css';
import { Enhancers } from '../(marketing)/Enhancers';
import { SiteNav } from '../(marketing)/SiteNav';
import { SiteFooter } from '../(marketing)/SiteFooter';

export const metadata: Metadata = {
  title: 'About — Nibbin',
  description:
    'Most AI tools hand you a blank box and wish you luck. Nibbin learns from your actual work, on your device, and turns what you keep repeating into agents you can trust. Built by a team from Google, Block, and PayPal.',
  alternates: { canonical: '/about' },
};

// Supporting contrast block. The Nibbin row deliberately flips the second
// column from "where it breaks" to the payoff, so it carries its own mobile
// label.
const COMPARE = [
  {
    tool: 'Chat tools',
    asks: 'Start over and re-explain everything each session',
    breaks: 'No memory of your actual work; you’re the context engine',
  },
  {
    tool: 'Automation builders',
    asks: 'Map every step by hand before anything runs',
    breaks: 'You have to describe a process you’ve never written down',
  },
  {
    tool: 'Agent platforms',
    asks: 'Spec out an agent up front',
    breaks: 'You’re guessing at a workflow you haven’t tested',
  },
];

const FAMILIAR = [
  {
    h: 'The weekly thing you’ve never explained to anyone.',
    p: 'There’s some task you do every week that lives entirely in your hands. You’ve never written it down because you’ve never needed to. A chat tool can’t help with it: you’d have to explain it first, and explaining it is half the work. Nibbin just watches you do it and learns the steps.',
  },
  {
    h: 'The automation you’d build if you had a free afternoon you’ll never have.',
    p: 'You know exactly which part of your week is wasteful. You also know that sitting down to wire it up in some builder would cost more time than it saves this month, this quarter, maybe this year. So it never happens. Nibbin removes the afternoon. The setup is you doing the work.',
  },
  {
    h: 'The context you paste in every single time.',
    p: 'Every chat session, you re-establish the same background before you get anything done. Who you are, what the project is, how you like things handled. Nibbin already knows, because it was there when the work happened.',
  },
];

export default function AboutPage() {
  return (
    <main className="landing" id="top">
      <Enhancers />
      <SiteNav />

      <header className="ab-hero">
        <div className="wrap">
          <span className="eyebrow">About Nibbin</span>
          <h1 className="ab-h1">Most AI tools hand you a blank box and wish you luck.</h1>
          <div className="ab-lead">
            <p>
              The models are good now. That stopped being the problem a while ago. The real gap is between what a model
              can do and what a person can actually get it to do, and that gap is wider than anyone selling AI wants to
              admit.
            </p>
            <p>
              To get real work out of these tools, you have to know what to ask, how to phrase it, what context to
              paste in, and how to break your own process into steps a machine can follow. That’s a skill. Most people
              don’t have it, and there’s no reason they should. Their job was never “prompt engineer.” So the
              capability sits there, mostly unused, while people keep doing by hand the exact things the model could
              already handle, if only someone had set it up right.
            </p>
            <p>
              We’re a small team that has spent about fifteen years building payments, risk, and AI systems at Google,
              Block, and PayPal, for products used by tens of millions of people, in regulated places where trust has
              to be earned. The capability in these tools is real. Most people just never get a fair shot at it, and
              that’s the gap we’re building Nibbin to close.
            </p>
          </div>
        </div>
      </header>

      <section className="ab-body">
        <div className="wrap">
          <article className="ab-prose reveal">
            <h2>The part nobody fixes</h2>
            <p>Every tool in this space asks you to do the same thing first: describe your work.</p>
            <p>
              Chat tools start you on a blank page. Every session, you re-explain who you are and what you’re working
              on before you get anything useful. Automation builders make you map out each step by hand before a single
              thing runs. Agent platforms want you to write a spec for an agent you haven’t even tested yet.
            </p>
            <p>
              They all share one assumption: that you can explain your work well enough to configure a machine to do
              it. But the reason you wanted help in the first place is that your work is messy. It’s full of judgment
              calls, exceptions, and small decisions you make without thinking about them. Ask someone to write down
              their process and you get a clean version that leaves out everything that actually matters. Watch them do
              it and you see what really happens.
            </p>
            <p className="ab-punch">That’s the whole thing. The description is the lie. The work is the truth.</p>
          </article>

          <div className="ab-compare reveal">
            <div className="ab-row ab-row-head">
              <span className="ab-cell" />
              <span className="ab-cell">What it asks of you</span>
              <span className="ab-cell">Where it breaks</span>
            </div>
            {COMPARE.map((row) => (
              <div className="ab-row" key={row.tool}>
                <span className="ab-cell ab-tool">{row.tool}</span>
                <span className="ab-cell">
                  <span className="ab-label">What it asks</span>
                  {row.asks}
                </span>
                <span className="ab-cell">
                  <span className="ab-label">Where it breaks</span>
                  {row.breaks}
                </span>
              </div>
            ))}
            <div className="ab-row ab-row-feat">
              <span className="ab-cell ab-tool">Nibbin</span>
              <span className="ab-cell">
                <span className="ab-label">What it asks</span>
                Nothing extra, just do your work
              </span>
              <span className="ab-cell">
                <span className="ab-label">Why it works</span>
                It learns from what actually happens, not your description of it
              </span>
            </div>
          </div>

          <article className="ab-prose reveal">
            <h2>What Nibbin does instead</h2>
            <p>Nibbin learns from the work, not from your account of it.</p>
            <p>
              It runs on your machine and pays attention to how you actually get things done: the real sequence, the
              real files, the real choices you make. From that, it builds agents and workflows out of what it sees. You
              don’t write prompts. You don’t draw flowcharts. You don’t sit down for an afternoon to “set up your
              automations.” You do your work, like always, and Nibbin turns the parts you keep repeating into Nibbins
              that can take them off your plate.
            </p>
            <p>
              It stays local and private by default. The observer watching your work is yours, on your device, working
              only for you.
            </p>
          </article>

          <h3 className="ab-familiar-h">This might sound familiar</h3>
          <div className="ab-examples reveal">
            {FAMILIAR.map((ex) => (
              <div className="ab-card" key={ex.h}>
                <strong>{ex.h}</strong>
                <p>{ex.p}</p>
              </div>
            ))}
          </div>

          <div className="ab-cta reveal">
            <h2>We’re building Nibbin now.</h2>
            <p>
              The waitlist is open. If a tool that learns your work instead of making you explain it sounds like what
              you’ve been waiting for, come get early access.
            </p>
            <a className="btn btn-solid" href="/#join">
              Join the waitlist
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
