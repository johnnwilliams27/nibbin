import type { Metadata } from 'next';
import '../(marketing)/landing.css';
import '../(marketing)/about.css';
import { Enhancers } from '../(marketing)/Enhancers';
import { SiteNav } from '../(marketing)/SiteNav';
import { SiteFooter } from '../(marketing)/SiteFooter';

export const metadata: Metadata = {
  title: 'About — Nibbin',
  description:
    'Most AI tools hand you a blank box and wish you luck. Nibbin learns from your actual work — on your device, private by default — and turns what you keep repeating into agents you can trust.',
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
    p: 'There’s some task you do every week that lives entirely in your hands. You’ve never written it down because you’ve never needed to. A chat tool can’t help with it — you’d have to explain it first, and explaining it is half the work. Nibbin just watches you do it and learns the steps.',
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

// The transparency / control / privacy cluster — grouped so it reads as one
// set. Same vocabulary as the home page band (track record · scope · off means
// off). Plain and direct, no brand whimsy: trust copy that sounds cute
// undercuts itself.
const CONTROL = [
  {
    h: 'You stay in charge of every Nibbin',
    ps: [
      'Spinning up agents is the easy part. The moment you have a few of them doing real work, a harder question shows up, and almost no tool answers it: can you trust them, and how would you even know?',
      'Most platforms leave you guessing. The agent runs, something happens, and you either believe it or you babysit it, which defeats the point of having it. We treat that as the actual product, not the fine print. Every Nibbin shows its work — what it did, when, on what, and how it turned out. You watch one closely until you trust it, then you stop watching.',
    ],
  },
  {
    h: 'Quality you can see, not guess at',
    ps: [
      'An agent is only worth keeping if it’s good, and “good” shouldn’t be a feeling. Each Nibbin carries a track record you can read: where it succeeds, where it slips, how often you’ve had to step in and fix something. When one stops pulling its weight, you find out before it costs you, not after. You should never have to take an agent’s word for its own performance.',
    ],
  },
  {
    h: 'You set the boundaries, the agent earns them',
    ps: [
      'A Nibbin does not decide what it’s allowed to touch. You do. Permissions and scope are granted by a person, on purpose, and they start narrow. An agent earns more room by proving it can handle what it already has, and you can take that room back at any time, no friction, no negotiation. The person holds the keys. That doesn’t change as the Grove gets bigger.',
    ],
  },
  {
    h: 'Watched only if you want it watched',
    ps: [
      'Nibbin learns by paying attention to your work, and that only happens on your terms. You choose what it sees and what stays off-limits, and nothing is observed or learned from unless you’ve said it can be. The screen capture it learns from never leaves your device. It stays on your machine, not on our servers, and off means off. We didn’t add privacy late to check a box. It’s where we started, and everything else is built on top of it.',
    ],
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
              The models are good now. That stopped being the problem a while ago. The problem is the gap between what
              a model can do and what a person can actually get it to do — and that gap is wider than anyone selling AI
              wants to admit.
            </p>
            <p>
              To get real work out of these tools, you have to know what to ask, how to phrase it, what context to
              paste in, and how to break your own process into steps a machine can follow. That’s a skill. Most people
              don’t have it, and there’s no reason they should. Their job was never “prompt engineer.” So the
              capability sits there, mostly unused, while people keep doing by hand the exact things the model could
              already handle — if only someone had set it up right.
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
              They all share one assumption — that you can explain your work well enough to configure a machine to do
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
                Nothing extra — just do your work
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
              It runs on your machine and pays attention to how you actually get things done — the real sequence, the
              real files, the real choices you make. From that, it builds agents and workflows out of what it sees. You
              don’t write prompts. You don’t draw flowcharts. You don’t sit down for an afternoon to “set up your
              automations.” You do your work, like always, and Nibbin turns the parts you keep repeating into Nibbins
              that can take them off your plate.
            </p>
            <p>
              It stays local and private by default. The thing watching your work is yours, on your device, working for
              you and no one else.
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

          <article className="ab-prose reveal">
            <h2>Why we think we can pull this off</h2>
            <p>
              The easy version of this product is another chat box or another drag-and-drop node editor. Plenty of
              those exist. They’re easy precisely because they push the hard part onto you.
            </p>
            <p>
              The hard version — learn from raw activity on a device, keep it private, and turn unstructured real
              behavior into automation you can actually trust — is the one worth building, and it’s close to the work
              we know best. Years at Google and Block, building products used by people all over the world, taught us
              where software actually hurts: the small, repeated friction that never makes a roadmap but quietly eats
              up people’s days. We’ve also spent enough time inside today’s agent tools to see the other half of the
              problem: when these things reach people who aren’t AI experts, the capability is right there, but knowing
              how to aim it at your own work turns out to be its own skill, and most people are left to work it out
              alone. Those everyday problems are the ones we care most about, and we’d rather solve them once, properly,
              than make millions of people keep doing the tedious thing forever.
            </p>

            <h2>How it grows</h2>
            <p>
              Nibbin doesn’t arrive knowing everything, and it shouldn’t. It starts with one small thing it learned you
              doing. You let it handle that. It earns a little more. Over time the Grove fills in — agents that grew up
              around your actual work instead of a template someone guessed at. The longer you use it, the more it
              sounds like you, because it learned from you and not from a manual.
            </p>
          </article>

          <div className="ab-control reveal">
            <h2 className="ab-control-h">You stay in control</h2>
            <div className="ab-cluster">
              {CONTROL.map((block) => (
                <div className="ab-item" key={block.h}>
                  <h3>{block.h}</h3>
                  {block.ps.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              ))}
            </div>
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
