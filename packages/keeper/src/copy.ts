/**
 * Every word the Grovekeeper says during onboarding, in one place — voice
 * rules per the brand-voice skill: warm, plainspoken, first person, sentence
 * case, one question at a time, never "as an AI", never guilt-trips.
 */
import type { QuestionChip } from './types';

export const NAME_MAX = 40;
export const ANSWER_MAX = 300;

export const HATCH = {
  greeting: "Oh — there you are. I've been waiting for this part.",
  introduction:
    "I'm your Grovekeeper. I look after this grove — the helpers who'll live here, and you.",
};

export const ASK_USER_NAME = {
  prompt: 'Before we go any further: what should I call you?',
  placeholder: 'Your name',
  ack: (name: string) => `Good to meet you, ${name}. Welcome to your grove.`,
  retry: "I'd hate to keep calling you \"you\". What should I call you?",
  tooLong: `That's a lot of name for my little journal — could you give me something under ${NAME_MAX} letters?`,
};

export const ASK_KEEPER_NAME = {
  prompt: 'Now the important bit. I need a name too, and it has to come from you. What will you call me?',
  placeholder: 'A name for me',
  ack: (name: string) => `${name}. I like it — carved on the lantern, official.`,
  retry: "I really do need a name — it's how this grove becomes yours. Try one on me.",
  tooLong: `A grand name, but I'd never remember it all. Something under ${NAME_MAX} letters?`,
};

export const SKIP_CHIP: QuestionChip = { id: 'skip', label: 'Skip this one' };

export const Q_CRAFT = {
  prompt: "Three quick questions so I'm useful from day one — skip any of them. First: what's the work you do?",
  placeholder: 'Photographer, bookkeeper, carpenter…',
  ack: 'Good — that tells me a lot about where to look.',
  skipAck: 'Skipped — no trouble.',
  tooLong: 'Save some for the grove tour — the short version will do.',
};

export const Q_TIME = {
  prompt: "Second: what eats the most of your week that isn't the work itself?",
  placeholder: 'Chasing replies, invoices, scheduling…',
  ack: "That's exactly the busywork I'm here to nibble away.",
  skipAck: 'Fair enough — skipped.',
  tooLong: 'The short version will do — just the worst of it.',
};

export const CHANNEL_CHIPS: QuestionChip[] = [
  { id: 'email', label: 'Email' },
  { id: 'instagram_dms', label: 'Instagram DMs' },
  { id: 'calls', label: 'Calls' },
  { id: 'texts', label: 'Texts' },
  { id: 'other', label: 'Somewhere else' },
];

export const Q_CHANNELS = {
  prompt: 'Last one: where does work usually arrive?',
  ack: 'Perfect — now I know which doors to watch.',
  skipAck: 'No matter — I find the doors eventually.',
};

export const DONE = {
  title: "That's everything I need",
  detail:
    'Connecting your accounts comes next — that is when the real nibbling starts. Until then this grove is yours, and so am I. Ask me anything.',
};

/* ── Next-step affordance (NIB-4) ────────────────────────────────────────────
   Shown at step === 'done'. Two stages, switched on whether an account has an
   active connection yet. Stage 1 nudges toward connecting; stage 2 nudges
   toward running a field study in the desktop app. */
export const NEXT_STEP = {
  connect: {
    title: 'Ready when you are.',
    detail: "Connect an account and I'll start finding the busywork worth nibbling.",
    cta: 'Connect an account',
  },
  fieldStudy: {
    title: 'Now I can really watch.',
    detail: "Run a field study in the desktop app and I'll learn where your time actually goes.",
    cta: 'Start a field study',
    dismiss: 'Not now',
  },
} as const;

/* ── Freeform chat (post-onboarding, M2 scope) ───────────────────────────── */

export const CHAT = {
  abilities:
    "Right now I can keep your grove, remember what matters to you, and answer what I know. Connecting your accounts and adopting your first Nibbins comes next — that's when I start finding busywork to nibble away.",
  credits:
    'Your credits are on the grove page — every task a Nibbin completes uses some. Nothing spends without you seeing it.',
  privacy:
    "Plainly: connections request the access your Nibbins may use. You set the action level for each one — Observe, Draft, or Send — and Agent School grades how well it is doing so you know when to grant more. And I myself can't touch anything — I read, plan, and talk, that's all.",
  fallback:
    "I don't have a good answer for that yet — most of my craft arrives with your connectors and your first Nibbins. Ask me about the grove, or just keep me company.",
  empty: "I'm listening — say the word.",
};
