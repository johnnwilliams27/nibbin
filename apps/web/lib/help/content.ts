import type { HelpContent } from "./types";

export function filterHelp(query: string, content: HelpContent): HelpContent {
  const q = query.trim().toLowerCase();
  if (!q) return content;
  const hit = (s: string) => s.toLowerCase().includes(q);
  return content
    .map((section) => ({
      ...section,
      articles: section.articles.filter(
        (a) => hit(a.q) || hit(a.body) || (a.keywords || []).some(hit) || hit(section.title),
      ),
    }))
    .filter((section) => section.articles.length > 0);
}

export const HELP_CONTENT: HelpContent = [
  // --- GETTING STARTED (fully authored) ------------------------------------
  {
    id: "getting-started",
    title: "Getting started",
    intro:
      "Nibbin gives you a grove of little helpers — Nibbins — that learn how you work and take routine chores off your plate. They never act on their own until they’ve earned your trust, draft by draft. Four moves get you there: sign in → run a Field Study → read your diagnosis → approve drafts.",
    articles: [
      {
        id: "gs-what-is-nibbin",
        q: "What is Nibbin, in plain language?",
        body:
          "Nibbin is a grove of little AI helpers that privately learn how you work, tell you where your time goes, and grow small agents (“Nibbins”) that take routine chores off your plate. Each helper is built from your patterns — not generic templates — and earns the right to act on its own one approved draft at a time.",
        keywords: ["overview", "intro", "what is", "helpers", "agents"],
      },
      {
        id: "gs-who-is-it-for",
        q: "Who is Nibbin for?",
        body:
          "People who work for themselves — solopreneurs, freelancers, and small creative service businesses (photographers, videographers, designers, and the like). If you spend hours each week on the same emails, follow-ups, and admin, Nibbin is built for you.",
        keywords: ["freelancer", "solopreneur", "small business", "who"],
      },
      {
        id: "gs-create-account",
        q: "How do I create an account?",
        body:
          "Go to nibbin.com and sign up with your email and a password. That single login works on both the web app and the desktop app — no separate accounts. When you land in your grove, your Grovekeeper greets you and walks you through a short onboarding: “Meet your Keeper” → “About you” → “Set up the app” → “You’re live.” You can skip any question.",
        keywords: ["sign up", "register", "login", "password", "account", "onboarding"],
      },
      {
        id: "gs-what-is-grovekeeper",
        q: "What is the Grovekeeper?",
        body:
          "Your guide and narrator. The Grovekeeper chats with you, writes your diagnosis letter, and keeps your grove tidy — but it can never send or change anything. It holds zero side-effect tools, permanently. Its name is set during onboarding and then locked.",
        keywords: ["keeper", "guide", "grovekeeper", "chat"],
      },
      {
        id: "gs-install-desktop",
        q: "Do I need to install anything?",
        body:
          "Yes — the desktop app is where the Field Study happens and where your Nibbins connect to your tools. On Grove Home there’s a “Get the desktop app” card with “Download for macOS” and “Download for Windows.” Install it on the computer you actually work from. Sign in with the same email and password.",
        keywords: ["install", "desktop app", "download", "mac", "windows"],
      },
      {
        id: "gs-field-study-intro",
        q: "What is a Field Study and why do I need one?",
        body:
          "A Field Study is a timed, on-device observation of how you actually work. It runs from the desktop app, stays encrypted on your machine the whole time, and produces a diagnosis that shows where your time goes and which Nibbins can help.\n\nTwo modes:\n• Full Field Study — 14-day deep observation, produces your complete diagnosis.\n• Quick Scan — capture and diagnose one task right now, auto-stops in about 6 hours.",
        keywords: ["field study", "observation", "capture", "diagnosis", "quick scan"],
      },
      {
        id: "gs-run-field-study",
        q: "How do I run my first Field Study?",
        body:
          "Open the desktop app and tap the Field Study tab. Choose:\n\n1. Full Field Study (14-day) or Quick Scan (one task, about 6 hours).\n2. Depth: Lite is live now; Detailed (periodic on-device screenshots) is coming soon.\n3. Read and accept the Consent screen — it spells out exactly what’s captured, what’s never captured, and how to stop.\n4. The study runs quietly in the background. You can Pause/Resume, End early, or press the global pause hotkey (⌘⇧. on Mac / Ctrl+Shift+. on Windows) at any moment.\n\nWindows screen capture is live now. macOS screen capture is coming soon.",
        keywords: ["field study", "start", "run", "consent", "lite", "detailed", "pause", "hotkey"],
      },
      {
        id: "gs-review-data",
        q: "Can I see what was captured before it leaves my device?",
        body:
          "Yes — that’s a core part of how Nibbin works. During and after the study, the Review tab in Field Study shows every captured event, already redacted (names, emails, and numbers replaced). You can delete any single event or clear a whole app’s worth.\n\nWhen the study ends, the app builds a diagnosis packet on your device and shows you a review-before-upload screen. You see each workflow found and can remove anything you don’t want included. Then choose “Send to Nibbin” to upload only that redacted packet, or “Delete instead” to wipe it and send nothing.\n\nThe raw study data is only deleted after the upload succeeds — your recordings never leave and are never deleted before you’ve confirmed the packet.",
        keywords: ["review", "redacted", "delete", "packet", "upload", "privacy"],
      },
      {
        id: "gs-read-diagnosis",
        q: "What does my diagnosis show?",
        body:
          "Open Your diagnosis (/app/diagnosis) — “Where your week actually goes.” It reveals:\n• A letter from your Grovekeeper.\n• Total routine hours per week.\n• How much could move to your grove.\n• A workflow map (“Where the hours go”).\n• Where your desktop time goes.\n• The biggest friction points.\n\nEach workflow can carry a recommendation to adopt a Nibbin — drafts only, for your approval, until it earns more. Or browse the Agent Shop and adopt any ready-made helper.",
        keywords: ["diagnosis", "workflow map", "hours", "routine", "recommend"],
      },
      {
        id: "gs-adopt-first-nibbin",
        q: "How do I adopt my first Nibbin?",
        body:
          "Three paths:\n1. Tap “Adopt” on a recommendation in your diagnosis.\n2. Browse the Agent Shop (/app/shop) and pick one of the six ready-made helpers: Sweep, Echo, Brief, Tally, Hopper, or Scribe.\n3. Go to Hatch Your Own (/app/hatch) and build one around a single chore (three steps: what’s the chore → where does it happen → name your egg).\n\nEvery Nibbin starts as an Egg, observing only. In a few days it becomes a Student and starts leaving drafts for your approval on Grove Home under “Needs you — your only to-do.”",
        keywords: ["adopt", "shop", "hatch", "egg", "student", "first nibbin"],
      },
      {
        id: "gs-connect-gmail",
        q: "How do I connect my tools?",
        body:
          "Go to Connections (/app/connections) — “Accounts your Nibbins work from.” Gmail is live today. Connections start read-only; a Nibbin asks for write access (drafting) separately and in plain words when it needs it.\n\nGoogle Calendar and Stripe show “Coming soon.” When you adopt a Nibbin that needs a tool you haven’t connected yet, you’ll see “That Nibbin needs [x] and [y] connected to finish adopting.”\n\nNote: Gmail connections are currently gated behind a tester allowlist while Google OAuth verification is pending. If you’re not on the list yet, you’ll see a prompt to request access.",
        keywords: ["connect", "gmail", "connections", "tools", "oauth", "allowlist"],
      },
      {
        id: "gs-approve-drafts",
        q: "What do I do with drafts?",
        body:
          "Drafts land on Grove Home under “Needs you.” For each one, tap “Approve & send” or “Edit first.” Your approvals — and any edits or rejections — are the training signal that helps your Nibbin improve.\n\nAs a Nibbin earns verified accuracy it climbs from Student → Senior → Graduate. Only a Graduate acts on its own. Trust is earned through accuracy, not time served.",
        keywords: ["approve", "draft", "edit", "reject", "training", "accuracy"],
      },
      {
        id: "gs-six-shop-nibbins",
        q: "What are the six Shop Nibbins?",
        body:
          "• Sweep — “Keeps your inbox floor clean.” Reads your inbox and hands you one short keep-or-clear list. Nothing deleted without you. Needs: Gmail.\n• Echo — “Never lets a thread go quiet.” Watches for overdue replies and drafts the nudge. Needs: Gmail.\n• Brief — “Your morning, on one card.” Reads yesterday/today across calendar, inbox, and money, and writes five lines every morning. Needs: Gmail + Google Calendar + Stripe.\n• Tally — “Minds the money you already earned.” Watches invoices and drafts the polite payment nudge. Needs: Stripe.\n• Hopper — “Keeps your calendar honest.” Checks tomorrow for unconfirmed sessions and drafts the confirmation. Needs: Google Calendar + Gmail.\n• Scribe — “Answers the question you answer every week.” Drafts your reply to repeat inquiries in your voice. Needs: Gmail.\n\nAll start drafting-only and earn autonomy through Agent School.",
        keywords: ["sweep", "echo", "brief", "tally", "hopper", "scribe", "shop", "six"],
      },
      {
        id: "gs-agent-school",
        q: "What is Agent School?",
        body:
          "Agent School is how every Nibbin earns trust. There are four stages:\n• Egg — observes only, drafts nothing yet.\n• Student — drafts everything for your approval.\n• Senior — acts on its own for routine work it has proven, drafts the rest.\n• Graduate — acts on its own within its spec.\n\nPromotion happens when a Nibbin hits 95% approved-without-edits over a rolling 25-run window. Graduating from Senior to Graduate also requires proven accuracy across at least 4 distinct routine patterns, with high-stakes actions weighted more heavily. Demotion is one click and always your call — the system may nudge you if recent drafts are getting edited, but it never demotes automatically. Paused progress is never lost.",
        keywords: ["agent school", "egg", "student", "senior", "graduate", "promotion", "trust", "accuracy"],
      },
      {
        id: "gs-platform-status",
        q: "Is Nibbin on Mac and Windows?",
        body:
          "Both. Windows screen capture is live now. macOS screen capture is coming soon — the app runs on Mac (sign-in + your grove) but the native Field Study observation hasn’t shipped on macOS yet.",
        keywords: ["mac", "macos", "windows", "platform", "desktop"],
      },
    ],
  },

  // --- FIELD STUDY (shell -- Task 5 enriches) ------------------------------
  {
    id: "field-study",
    title: "Field Study",
    intro:
      "The Field Study is the on-device observation that produces your diagnosis. Everything stays on your machine; only a redacted summary can leave — and only when you choose.",
    articles: [
      {
        id: "fs-placeholder",
        q: "What does a Field Study capture?",
        body:
          "A Field Study captures active app names, window titles and shapes, and redacted text from accessibility info. It never captures passwords, secure fields, banking or health content, audio, or camera. Full detail is in the Privacy section.",
        keywords: ["capture", "field study", "what is recorded", "observation"],
      },
    ],
  },

  // --- PRIVACY (shell -- Task 5 enriches) ----------------------------------
  {
    id: "privacy",
    title: "Privacy & data",
    intro:
      "Your screen never leaves your computer — by architecture, not just policy. Here is what that means in practice.",
    articles: [
      {
        id: "privacy-placeholder",
        q: "Does Nibbin train its AI on my data?",
        body:
          "Nibbin never trains its models on your content — ever. That’s a hard guarantee, not a setting (there is no toggle because it never happens). Separately, a Model improvement toggle controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities and models perform — never your data, never your content, never sold. That toggle is ON by default (opt-out); turn it off anytime in Data & Privacy.",
        keywords: ["training", "ai", "data", "privacy", "model improvement", "opt-out"],
      },
    ],
  },

  // --- AGENTS (shell -- Task 5 enriches) -----------------------------------
  {
    id: "agents",
    title: "Nibbins & Agent School",
    intro:
      "Each Nibbin is a small helper that handles one kind of chore. Trust is earned through verified accuracy, not time served.",
    articles: [
      {
        id: "agents-placeholder",
        q: "How does a Nibbin earn the right to act on its own?",
        body:
          "A Nibbin earns autonomy through Agent School. It starts as an Egg (observe only), becomes a Student (drafts for approval), then a Senior (routine autonomy), then a Graduate (full in-spec autonomy). Promotion requires 95% approved-without-edits over a rolling 25-run window, with Senior→Graduate also requiring coverage of at least 4 distinct routine patterns.",
        keywords: ["autonomy", "trust", "egg", "student", "senior", "graduate", "promotion", "agent school"],
      },
    ],
  },

  // --- CONNECTIONS (shell -- Task 5 enriches) ------------------------------
  {
    id: "connections",
    title: "Connections",
    intro:
      "Connections are the accounts your Nibbins work from. Gmail is live today; Google Calendar and Stripe are coming soon.",
    articles: [
      {
        id: "connections-placeholder",
        q: "Which tools can I connect today?",
        body:
          "Gmail is the only connectable tool right now. Google Calendar and Stripe show “Coming soon” in the Connections page. Connections start read-only; a Nibbin asks for write/drafting access separately and in plain words only when it needs it. You can revoke any connection in one click.",
        keywords: ["gmail", "calendar", "stripe", "connect", "connections", "read-only"],
      },
    ],
  },

  // --- MEMORY (shell -- Task 5 enriches) -----------------------------------
  {
    id: "memory",
    title: "Grove Memory",
    intro:
      "Grove Memory is the shared brain your Nibbins draw on — facts, pricing, policies, voice, and hard rules you set.",
    articles: [
      {
        id: "memory-placeholder",
        q: "What is Grove Memory?",
        body:
          "Grove Memory (/app/memory) is your editable business brain — facts, pricing, policies, FAQ answers, voice, and hard rules your Nibbins can never break in a draft. Everything you write there is shared with all your helpers so their drafts sound like you. Edit or clear any of it anytime.",
        keywords: ["memory", "grove memory", "facts", "pricing", "policies", "voice", "hard rules"],
      },
    ],
  },

  // --- CHANNELS (fully authored) -------------------------------------------
  {
    id: "channels",
    title: "Channels & notifications",
    intro:
      "Your grove reaches you in more than one place. In-app notifications (“leaves”) are always there; Telegram is a live two-way channel; SMS and WhatsApp are coming once compliance clears. Secrets never travel through a channel — anything that needs a credential sends you back to the app.",
    articles: [
      {
        id: "ch-overview",
        q: "Where do my grove’s notifications go?",
        body:
          "Notifications land in a few places depending on what you’ve set up:\n• In the app — Your leaves (/app/notifications). Field Notes, training sessions, near-graduations, drift nudges, and ceremonies all land here. Mark them read individually.\n• Telegram — a live two-way conversational channel (see below).\n• Email — gentle study-progress and milestone nudges; toggle off anytime.\n• SMS and WhatsApp — built but compliance-gated (SMS on 10DLC, WhatsApp on Meta verification). Coming soon.\n\nDelivery always falls back to the in-app notification center if a channel isn’t connected or isn’t available right now.",
        keywords: ["notifications", "leaves", "email", "telegram", "sms", "whatsapp", "channels"],
      },
      {
        id: "ch-telegram-what",
        q: "What can I do through Telegram?",
        body:
          "Telegram is a two-way conversational channel — not just a one-way push. Once connected, you can:\n• Receive grove notifications directly in Telegram.\n• Tap inline Approve or Reject buttons on drafts without opening the app.\n• Ask your Grovekeeper status questions right from chat (e.g. “What’s Scribe up to?”).\n• Start work from chat: your Keeper can send a plan preview of a proposed task; approve it there and it runs; type “cancel” at any point to stop it.\n\nAnything that needs a credential or a sensitive action happens in the app, not through Telegram. Secrets never traverse a channel.",
        keywords: ["telegram", "approve", "reject", "two-way", "chat", "inline", "conversational", "cancel"],
      },
      {
        id: "ch-telegram-setup",
        q: "How do I connect Telegram?",
        body:
          "Follow these steps:\n\n1. Go to Settings → Data & Privacy → “Where your grove reaches you.”\n2. Tap Connect Telegram.\n3. Nibbin opens a deep link to t.me/<bot>?start=<nonce> — this link is bound to your authenticated session, so only your account can complete it.\n4. Tap Start in the Telegram app.\n5. Return to Nibbin settings — the row now shows “Connected.”\n\nTo disconnect, come back to the same row and tap Disconnect.",
        keywords: ["telegram", "setup", "connect", "deep link", "bot", "start", "settings", "disconnect"],
      },
      {
        id: "ch-telegram-safety",
        q: "Is it safe to use Telegram for approvals?",
        body:
          "Yes, within a clear boundary: Nibbin never sends secrets, credentials, or anything sensitive through Telegram. Approve and Reject buttons work for actions that are already safe to confirm in context. Anything that needs a credential, a payment confirmation, or a sensitive setting sends you a link back into the app where it happens securely.",
        keywords: ["telegram", "safe", "security", "secrets", "credentials", "approve", "boundary"],
      },
      {
        id: "ch-sms-whatsapp",
        q: "What about SMS and WhatsApp?",
        body:
          "Both are built and working in the codebase, but are compliance-gated:\n• SMS is waiting on 10DLC carrier registration.\n• WhatsApp is waiting on Meta business verification.\n\nOnce those clear, they’ll appear as connectable options in Settings → Data & Privacy → “Where your grove reaches you.” Email is always available in the meantime.",
        keywords: ["sms", "whatsapp", "coming soon", "10dlc", "meta", "compliance", "carrier"],
      },
      {
        id: "ch-quiet-hours",
        q: "Can I set quiet hours so notifications don’t interrupt me?",
        body:
          "Yes. In Settings → Data & Privacy → “Where your grove reaches you,” set quiet-hour start and end times plus your urgency threshold. Non-urgent notifications batch into a digest during quiet hours. Only genuinely urgent things cross quiet hours.\n\nOne exception: approval requests are work you asked for and aren’t suppressed by quiet hours — your Nibbins are waiting on your yes.",
        keywords: ["quiet hours", "digest", "urgency", "batch", "do not disturb", "threshold"],
      },
      {
        id: "ch-channel-prefs",
        q: "How do I control which notifications go where?",
        body:
          "In Settings → Data & Privacy → “Where your grove reaches you,” each connected channel has its own preferences:\n• Enable or disable the channel entirely.\n• Set an urgency threshold (only send things above a certain priority).\n• Configure quiet hours and digest mode.\n\nIf a channel is down or not connected, notifications fall back to the in-app notification center automatically.",
        keywords: ["preferences", "channel", "urgency", "enable", "disable", "fallback", "notification center"],
      },
      {
        id: "ch-start-work-from-chat",
        q: "Can I start work from Telegram?",
        body:
          "Yes — this is channel-initiated work. When your Keeper proposes a task, it sends you a plan preview in Telegram showing what it intends to do. Approve it there and the plan runs. You can type “cancel” at any point to stop it mid-run.\n\nAll side effects are still approval-gated — nothing runs autonomously just because it was started from chat.",
        keywords: ["channel-initiated", "start work", "telegram", "plan", "preview", "cancel", "approve", "chat"],
      },
    ],
  },

  // --- FAQ (shell -- Task 5 enriches) --------------------------------------
  {
    id: "faq",
    title: "Frequently asked questions",
    intro: "Quick answers to the most common questions.",
    articles: [
      {
        id: "faq-placeholder",
        q: "Does Nibbin record audio or use my camera?",
        body:
          "Never. Audio and camera are permanent exclusions — not roadmap items. There is no microphone or camera access in the Field Study or anywhere else in Nibbin.",
        keywords: ["audio", "camera", "microphone", "record", "never"],
      },
    ],
  },
];
