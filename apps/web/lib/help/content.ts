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
      "Nibbin gives you a grove of little helpers — Nibbins — that learn how you work and take routine chores off your plate. They never act on their own until they've earned your trust, draft by draft. Four moves get you there: sign in → run a Field Study → read your diagnosis → approve drafts.",
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

  // --- FIELD STUDY (fully authored) ----------------------------------------
  {
    id: "field-study",
    title: "Field Study",
    intro:
      "The Field Study is the on-device observation that produces your diagnosis. Everything stays on your machine; only a redacted summary can leave — and only when you choose.",
    articles: [
      {
        id: "fs-vs-quick-scan",
        q: "Field Study vs Quick Scan — which should I use?",
        body:
          "A full Field Study runs for 14 days and hard-stops automatically. It watches your whole work week across every app and produces the deep diagnosis: total routine hours, a workflow map, and a ranked list of which Nibbins can help most.\n\nA Quick Scan captures and diagnoses one task on demand and auto-stops after about 6 hours. Use it when you want a fast read on a specific workflow — “watch me answer inquiries this afternoon” — without committing to two weeks.\n\nYou can run both. Each one adds a card to Your diagnosis history, newest first.",
        keywords: ["field study", "quick scan", "difference", "14 day", "6 hours", "compare"],
      },
      {
        id: "fs-lite-vs-detailed",
        q: "What is the difference between Lite and Detailed capture?",
        body:
          "You choose capture depth when you start a study. There are two options:\n\n• Lite (live now, the default) — captures active app names, window titles and shapes, and redacted text from accessibility info. No screenshots are taken.\n• Detailed (coming soon, not selectable yet) — would add periodic screenshots processed on your device. These would never be uploaded raw; only derived, redacted summaries leave the machine.\n\nLite is the right choice for today. Detailed will appear as a selectable option once it ships.",
        keywords: ["lite", "detailed", "capture depth", "screenshots", "coming soon", "default"],
      },
      {
        id: "fs-what-is-captured",
        q: "What does a Field Study actually capture?",
        body:
          "During a study or Quick Scan, the observer records:\n• Active app names and window titles/shapes.\n• Redacted text from accessibility info (names, emails, and numbers are replaced before anything is written to disk).\n• Repeated action sequences and URL templates (the pattern, not the content).\n• Daily minutes per app.\n\nIt never captures:\n• Passwords or secure fields.\n• Banking, health, or other sensitive-category content.\n• Audio.\n• Camera.\n\nSensitive categories are auto-excluded before anything is saved — see the Privacy section for full detail.",
        keywords: ["capture", "what is recorded", "observation", "app names", "redacted", "excluded"],
      },
      {
        id: "fs-pause-resume",
        q: "How do I pause or stop a study?",
        body:
          "You have full control at any point:\n\n• Pause/Resume button — right on the Field Study → Home screen.\n• End study early — also on the Home screen; you’ll go straight to packet review.\n• Global pause hotkey — ⌘⇧. (Mac) or Ctrl+Shift+. (Windows). Press it from any app and capture stops near-instantly. Press it again (or tap Resume in the app) to continue.\n\nPausing never loses your progress. When you resume, the study picks up exactly where it left off. Time paused is not counted against your 14-day window.",
        keywords: ["pause", "resume", "stop", "hotkey", "ctrl+shift", "cmd", "end study"],
      },
      {
        id: "fs-field-notes",
        q: "What are Field Notes?",
        body:
          "Field Notes is a sub-tab in the desktop app’s Field Study view. It shows on-device-only stats computed from your already-redacted events:\n• Total event count.\n• Active time so far.\n• Number of pauses.\n• Days elapsed in the study.\n• A “Where the day went” breakdown by app.\n\nNothing shown in Field Notes is uploaded. It’s computed and shown on your machine only — a live window into what the observer has seen, before any packet is built.",
        keywords: ["field notes", "stats", "on device", "event count", "breakdown", "local"],
      },
      {
        id: "fs-review-exclusions",
        q: "How do I review captured events and add exclusions?",
        body:
          "The Review tab in Field Study lists every captured event, grouped by app, already redacted. You can:\n• Delete a single event.\n• Delete everything from one app.\n• Add an app or website to your exclusions so it’s never recorded again.\n\nExclusions persist across studies and sessions. Once you exclude an app or site, it stays excluded until you remove it — you’ll never need to remember to exclude it again.\n\nYou can also add exclusions from the Preferences tab without going through Review.",
        keywords: ["review", "exclusions", "delete", "app", "site", "never record", "persistent"],
      },
      {
        id: "fs-idle-suspend",
        q: "Does the observer run when I’m away from my computer?",
        body:
          "No. The observer detects when your computer is idle and suspends capture automatically. It only records during active use. This keeps the study focused on real work patterns and means nothing is captured when you’re away from the desk.",
        keywords: ["idle", "suspend", "away", "inactive", "battery", "background"],
      },
      {
        id: "fs-daemon",
        q: "What is the Observer / daemon?",
        body:
          "The Observer (internally called observerd) is the background piece of the desktop app that does the capturing. A few things about it:\n• It is dormant by default — it only runs during an active study or Quick Scan.\n• It enforces the 14-day hard stop itself, with an anti-rollback clock that can’t be cheated by changing the system date.\n• It is the piece the global pause hotkey stops near-instantly.\n• It runs inside the app — uninstalling the app removes it.\n\nIf the observer goes offline mid-study, the Field Study view shows a health note with a Retry option. A short poll cycle gives it a moment to reconnect before reporting the status.",
        keywords: ["observer", "daemon", "observerd", "background", "hard stop", "anti-rollback", "dormant"],
      },
      {
        id: "fs-delete-study",
        q: "How do I delete a study and what happens after?",
        body:
          "You have two delete paths:\n\n1. Delete the raw study data on your device — tap “Delete everything” in Preferences or from the packet-review screen. The app verifies the data is gone before confirming. This is always available, in any state, even mid-study.\n\n2. Delete a past diagnosis from the web — open Your diagnosis, find the study card, tap the delete option, and confirm. This removes the diagnosis from your grove.\n\nAfter you choose “Delete instead” on the packet-review screen (instead of uploading), the raw data is wiped on your device and nothing is sent to Nibbin. Your account receives a deletion receipt confirming what was removed.",
        keywords: ["delete", "delete everything", "wipe", "receipt", "diagnosis", "raw data", "purge"],
      },
    ],
  },

  // --- PRIVACY (fully authored) --------------------------------------------
  {
    id: "privacy",
    title: "Privacy & data",
    intro:
      "Your screen never leaves your computer — by architecture, not just policy. Here is what that means in practice.",
    articles: [
      {
        id: "priv-local-capture",
        q: "Does the Field Study send my screen recordings anywhere?",
        body:
          "No. Screen recordings never leave your device — by architecture, not policy. The capture module has no way to send anything to the network. Only a redacted, structured summary (the synthesis packet) can leave, and only when you choose to build your diagnosis.\n\nThe raw study data lives in an encrypted local store, with the key wrapped by your OS keystore. It stays there until you delete it or until your diagnosis is built — at which point it is verifiably deleted.",
        keywords: ["screen recording", "upload", "local", "on device", "architecture", "encrypted", "raw data"],
      },
      {
        id: "priv-review-before-upload",
        q: "Can I review everything before it leaves my machine?",
        body:
          "Yes. When a study ends, the app builds a diagnosis packet on your device and shows you a review-before-upload screen. You see every workflow it found and can remove any of them. Then you choose:\n• “Send to Nibbin” — uploads only the redacted packet.\n• “Delete instead” — wipes everything locally and sends nothing.\n\nThe raw recordings are only deleted after the upload succeeds. Nothing is deleted before you’ve confirmed the packet, and nothing is uploaded before you approve it.",
        keywords: ["review", "packet", "upload", "delete instead", "before upload", "workflow", "remove"],
      },
      {
        id: "priv-secure-fields",
        q: "Can Nibbin capture my passwords or secure fields?",
        body:
          "No. Passwords and secure fields can’t be captured — by construction, never by reading the picture. Suppression is structural: a password box can’t be recorded even in Detailed mode. This is an architectural guarantee, not a software setting that could be misconfigured.\n\nBanking, health, and other sensitive-category content are also blocked before anything is written to disk (auto-excluded at the system level). You can additionally mark any app or site as “never record” yourself from the Review or Preferences tab.",
        keywords: ["password", "secure fields", "banking", "health", "sensitive", "blocked", "by construction"],
      },
      {
        id: "priv-no-audio-camera",
        q: "Does Nibbin record audio or use my camera?",
        body:
          "Never. Audio and camera are permanent exclusions — not roadmap items and not toggles. There is no microphone or camera access anywhere in Nibbin. You will never be asked to grant audio or camera permissions.",
        keywords: ["audio", "camera", "microphone", "never", "permanent"],
      },
      {
        id: "priv-pause-hotkey",
        q: "How do I stop capture instantly?",
        body:
          "The global pause hotkey — ⌘⇧. (Mac) / Ctrl+Shift+. (Windows) — stops capture near-instantly. Press it from any app; you don’t need to switch back to Nibbin. Press it again or tap Resume in the Field Study view to continue.\n\nYou can also pause from the Field Study → Home screen at any time.",
        keywords: ["pause", "hotkey", "stop", "instantly", "cmd", "ctrl+shift", "global"],
      },
      {
        id: "priv-verified-deletion",
        q: "How is my data deleted, and is there proof?",
        body:
          "Raw study data is verifiably deleted after your diagnosis packet is safely uploaded. An independent verifier confirms the raw data is gone, and the deletion is user-visible in the app.\n\nIf you choose “Delete instead” at packet review, the raw data is wiped and nothing is uploaded — your account receives a deletion receipt confirming what was removed.\n\nFor account deletion: go to Settings → Account, type your account name, and start the 30-day cancelable countdown. Your tools disconnect immediately. After 30 days, everything is permanently removed and you receive a receipt.",
        keywords: ["delete", "verified deletion", "receipt", "proof", "raw data", "account deletion", "30 days"],
      },
      {
        id: "priv-sensitive-blocklist",
        q: "How does the sensitive-category blocklist work?",
        body:
          "Nibbin auto-excludes banking, health, and other sensitive categories before anything is written to disk. This runs at the system level — you’ll see a honey-tinted capture-blocked banner when you’re in an excluded app or site.\n\nYou can also add your own exclusions (any app or website) from the Review tab or Preferences. Exclusions are durable and fail-closed: if there’s any uncertainty about whether something should be captured, it isn’t.",
        keywords: ["blocklist", "sensitive", "banking", "health", "excluded", "auto-exclude", "fail-closed"],
      },
      {
        id: "priv-model-training",
        q: "Does Nibbin train its AI on my content?",
        body:
          "No, and there is no toggle for this — because it never happens. Nibbin never trains its models on your content. That’s a hard guarantee.\n\nSeparately, there is a Model improvement toggle that controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities and models perform — never your data, never your content, never sold. That toggle is ON by default (opt-out). You can turn it off anytime in Settings → Data & Privacy.\n\nThose are two different things: the first (no content training) has no toggle because it never happens; the second (aggregate model signals) is optional and on by default.",
        keywords: ["model training", "ai", "content", "model improvement", "opt-out", "toggle", "anonymized", "aggregate"],
      },
      {
        id: "priv-connections-data",
        q: "What happens to data from my connected accounts (Gmail, etc.)?",
        body:
          "Connections start read-only. When a Nibbin needs to act (draft a reply, nudge a thread), it requests write access per Nibbin, in plain words, before doing anything.\n\nConnection tokens are stored in an encrypted vault, not in the app database. One-click revoke cascades to all associated grants and destroys the stored token immediately.\n\nFor the optional Gmail voice-learning sweep: if you opt in, sent messages are processed by the model and your inbox is reduced to subjects and previews — only short derived notes are kept. The raw mail is not retained. This is off by default and opt-in only.",
        keywords: ["gmail", "connections", "read-only", "token", "vault", "revoke", "sweep", "voice learning"],
      },
      {
        id: "priv-no-telemetry",
        q: "Does Nibbin send any telemetry or sell my data?",
        body:
          "No telemetry and no data sales. Nibbin does not quietly phone home with usage analytics. Your data is never sold. The Grovekeeper can never send or change anything by design — it holds zero side-effect tools permanently.\n\nThe only subprocessors involved are Anthropic (for AI models) and Voyage (for embeddings on already-redacted derived text only).",
        keywords: ["telemetry", "data sales", "privacy", "subprocessors", "anthropic", "voyage", "phone home"],
      },
      {
        id: "priv-retention",
        q: "How long does Nibbin keep my data?",
        body:
          "Here is what is kept and for how long:\n• Raw Field Study data — on your device, until your diagnosis is built (14 days max).\n• Agent run logs — 90 days by default; shorten or wipe anytime in Settings → Data & Privacy.\n• Connection tokens — encrypted vault while connected; one-click revoke destroys them immediately.\n• Account data — life of the account, plus 30 days after verified deletion.\n\nYou can shorten any of these or delete everything from the desktop app’s Preferences tab.",
        keywords: ["retention", "how long", "90 days", "14 days", "30 days", "logs", "delete"],
      },
    ],
  },

  // --- AGENTS (fully authored) ---------------------------------------------
  {
    id: "agents",
    title: "Nibbins & Agent School",
    intro:
      "Each Nibbin is a small helper that handles one kind of chore. Trust is earned through verified accuracy, not time served.",
    articles: [
      {
        id: "agents-shop-overview",
        q: "What is the Agent Shop?",
        body:
          "The Agent Shop (/app/shop) is where you browse and adopt the six ready-made Nibbins. Each has a clear tagline, a description of what it does, and a list of the connections it needs. All start as drafting-only and earn autonomy through Agent School.\n\nThe six are:\n• Sweep — “Keeps your inbox floor clean.” Keep-or-clear inbox list. Needs: Gmail.\n• Echo — “Never lets a thread go quiet.” Overdue-reply nudges. Needs: Gmail.\n• Scribe — “Answers the question you answer every week.” Repeat-inquiry replies in your voice. Needs: Gmail.\n• Brief — “Your morning, on one card.” Five-line morning summary. Needs: Gmail + Google Calendar + Stripe.\n• Tally — “Minds the money you already earned.” Overdue invoice nudges. Needs: Stripe.\n• Hopper — “Keeps your calendar honest.” Tomorrow’s booking confirmations. Needs: Google Calendar + Gmail.",
        keywords: ["shop", "six", "sweep", "echo", "scribe", "brief", "tally", "hopper", "ready-made"],
      },
      {
        id: "agents-adopt-lifecycle",
        q: "What happens when I adopt a Nibbin?",
        body:
          "Adoption starts with a brief hatch ceremony, then:\n\n• Egg — your Nibbin observes only and drafts nothing. It’s getting to know your work patterns. This lasts a few days.\n• Student — your Nibbin starts leaving drafts for your approval on Grove Home. Every draft needs your yes before anything happens. Your approvals and edits are its training signal.\n• Senior — after reaching 95% approved-without-edits over a rolling 25-run window, your Nibbin earns routine autonomy for the work it’s proven. It still drafts anything new or uncertain.\n• Graduate — Senior’s graduation also requires proven accuracy across at least 4 distinct routine patterns, with high-stakes actions weighted more. A Graduate acts on its own within its spec.\n\nPromotion is by accuracy, never by time served. Paused progress is never lost.",
        keywords: ["adopt", "hatch", "egg", "student", "senior", "graduate", "lifecycle", "ceremony"],
      },
      {
        id: "agents-promotion-demotion",
        q: "How does promotion and demotion work?",
        body:
          "Promotion is automatic when accuracy criteria are met:\n• Student → Senior: 95% approved-without-edits over a rolling 25-run window.\n• Senior → Graduate: same accuracy bar, plus coverage of at least 4 distinct routine patterns. High-stakes actions (like deleting or archiving) are weighted more heavily than reads.\n\nDemotion is always your call. The system may nudge you if recent drafts are getting edited (“want to put it back to drafts?”) but it never demotes automatically. One click from your Nibbin’s card puts it back to Student. Earned progress is frozen, not erased — paused or demoted Nibbins don’t lose their history.",
        keywords: ["promotion", "demotion", "accuracy", "25-run", "95%", "senior", "graduate", "nudge"],
      },
      {
        id: "agents-composer",
        q: "What is the Composer?",
        body:
          "The Composer builds a custom Nibbin for you from an email workflow in your diagnosis. When you see “Build a Nibbin for this” on a diagnosis recommendation, the Composer proposes a helper made of validated primitives — for example: “watch your inbox for overdue threads → draft a warm follow-up for your approval.”\n\nYou get a review-before-adopt card showing the workflow, the plain-language steps, the persona, the trigger, and the connectors it needs. Nothing exists until you confirm.\n\nToday’s Composer covers the detect-and-nudge family (overdue email, overdue invoices, unconfirmed events, new-inquiry replies) and the digest family (inbox cleanup, morning brief). The custom Nibbin hatches as an Egg and goes through Agent School exactly like a shop Nibbin — no shortcut to autonomy.\n\nComposer is early access / gated.",
        keywords: ["composer", "custom", "build", "diagnosis", "primitives", "review", "early access"],
      },
      {
        id: "agents-hatch-your-own",
        q: "How do I build my own Nibbin from scratch?",
        body:
          "Go to Hatch Your Own (/app/hatch) — “Build a Nibbin for one chore.” It takes three steps:\n1. What’s the chore? (plain description of what you want handled)\n2. Where does it happen? (which apps or tools)\n3. Name your egg and optionally customize its look.\n\nYour custom Nibbin hatches as an Egg and earns autonomy through Agent School the same way every other Nibbin does — there’s no shortcut.",
        keywords: ["hatch", "custom", "build your own", "chore", "name", "egg", "from scratch"],
      },
      {
        id: "agents-training-mode",
        q: "What is Training mode and when should I use it?",
        body:
          "Training mode is a time-boxed, budget-bounded switch available on Student and Senior Nibbins. It surfaces more drafts for your review during a focused window so a Nibbin gathers approval signal faster.\n\nWhat it grants: more drafts, faster feedback.\nWhat it does not grant: autonomy, a lower accuracy bar, or any change to the graduation gate. Every draft still needs your yes.\n\nYou set the window length (1 hour to 14 days) and a cap on extra runs (up to 100). End it any time with “End training.”\n\nTraining mode is early access / gated. Use it when you want a Nibbin to graduate faster without changing how it earns that graduation.",
        keywords: ["training mode", "train faster", "drafts", "approval", "time-boxed", "early access", "graduate faster"],
      },
      {
        id: "agents-draft-approval",
        q: "How does draft approval work?",
        body:
          "Drafts appear on Grove Home under “Needs you — your only to-do.” For each one:\n• “Approve & send” — the Nibbin sends or acts exactly as drafted.\n• “Edit first” — make any change, then approve. The edit is logged as feedback.\n\nYou can also reject or dismiss a draft. Rejections are as useful as approvals — they teach the Nibbin a boundary.\n\nDrafts can also reach you via Telegram (inline Approve/Reject buttons) if you’ve connected it. Approval requests are never suppressed by quiet hours because they’re work you asked for.",
        keywords: ["draft", "approve", "edit", "reject", "grove home", "needs you", "feedback"],
      },
      {
        id: "agents-runaway-prevention",
        q: "What stops a Nibbin from doing too much?",
        body:
          "Several layers:\n• Every Nibbin only has the capabilities its spec lists — it can’t reach outside those.\n• Until it graduates, every side effect goes through you for approval.\n• The Planner (early access) is bounded: at most 30 loop iterations, capped tokens, at most 4 web calls, and at most 3 memory writes per run. Every side effect in a Planner run is approval-gated.\n• The Grovekeeper can never take any action — it holds zero tools by design.\n• Type “cancel” in a Telegram plan preview to stop a run mid-flight.\n• Revoking a connection instantly suspends all the Nibbin’s grants for that tool.",
        keywords: ["runaway", "safety", "limits", "capabilities", "approval-gated", "cancel", "grovekeeper", "tools"],
      },
      {
        id: "agents-badges",
        q: "What are the Agent School badges and streaks?",
        body:
          "Your Nibbin’s card on Your Nibbins (/app/nibbins) shows its Agent School ladder, streaks, and earned badges. Badges include:\n• First Solo — first run it completed on its own.\n• Zero-Miss Month — a full month without an edited or rejected draft.\n• 100 Runs — hit the century mark.\n\nAll badge counts and streaks are read from real run history — nothing is fabricated. The card also shows “What [name] has learned about you” from its approved work.",
        keywords: ["badges", "streaks", "first solo", "zero-miss", "100 runs", "nibbins page", "history"],
      },
    ],
  },

  // --- CONNECTIONS (fully authored) ----------------------------------------
  {
    id: "connections",
    title: "Connections",
    intro:
      "Connections are the accounts your Nibbins work from. Gmail is live today; Google Calendar and Stripe are coming soon.",
    articles: [
      {
        id: "conn-what-do-connections-do",
        q: "What do Connections do?",
        body:
          "Connections (/app/connections) link your accounts — email, calendar, payments — so your Nibbins have something to work with. Without a connection, a Nibbin that needs Gmail can’t read threads or draft replies.\n\nConnections start read-only. When a Nibbin needs to take action (draft a reply, send a nudge), it asks for write access per Nibbin, in plain words, before doing anything. You can revoke any connection in one click, which instantly suspends all grants and destroys the stored token.",
        keywords: ["connections", "what do", "accounts", "read-only", "revoke", "tools"],
      },
      {
        id: "conn-whats-live",
        q: "Which connections are available today?",
        body:
          "Today, Gmail is the only connectable tool. When you connect Gmail, it starts with read-only access (gmail.readonly). If you adopt a Nibbin that drafts replies, it will ask for drafting scope separately, in plain words, before it can act.\n\nGoogle Calendar and Stripe show “Coming soon” on the Connections page — you can’t connect them yet. Brief, Tally, and Hopper need those connections to function fully.\n\nOther tools you might see mentioned in the Hatch Your Own picker (HoneyBook, Notion, QuickBooks, and others) are on the roadmap but not connectable today.",
        keywords: ["gmail", "live", "coming soon", "calendar", "stripe", "available", "today"],
      },
      {
        id: "conn-tester-allowlist",
        q: "Why do I see a “request access” message for Gmail?",
        body:
          "Gmail (and other Google connections) are currently gated behind a tester allowlist while Nibbin’s Google OAuth app verification is pending. Google caps the number of users during this review period.\n\nIf you’re not on the allowlist, you’ll see a prompt to request access on the Connections page. Once you’re approved, the Connect button becomes active.",
        keywords: ["tester allowlist", "request access", "gmail", "google", "oauth", "verification", "gated"],
      },
      {
        id: "conn-read-vs-write",
        q: "What is the difference between read access and write access?",
        body:
          "Every connection starts read-only. A Nibbin can read threads, calendar events, or invoice data — but can’t send, create, or change anything.\n\nWrite access is granted per Nibbin, by you, in plain words, only when a specific Nibbin needs it to do its job. The access label in Connections shows either “Read-only access” or “Includes actions you approve · revoke anytime.”\n\nWrite access can be revoked in one click from the Connections page. Revoking cascades: all grants for that tool are suspended and the stored token is destroyed immediately.",
        keywords: ["read-only", "write access", "grant", "per nibbin", "revoke", "drafting", "send"],
      },
      {
        id: "conn-privacy-of-data",
        q: "What happens to data from my connected accounts?",
        body:
          "Connection tokens are stored in an encrypted vault — not in the app database. Revoking a connection destroys the token immediately and suspends every associated grant.\n\nNibbins only ever read what their spec says they need. No connected data is retained longer than it needs to be for the task at hand.\n\nFor Gmail specifically: if you opt into the one-time voice-learning sweep, sent messages are processed by the model and your inbox is reduced to subjects and previews. Only short derived notes are kept — the raw mail is not retained. This sweep is off by default and opt-in only.",
        keywords: ["privacy", "connected data", "token", "vault", "gmail", "sweep", "retained"],
      },
      {
        id: "conn-directory",
        q: "Is there a full list of available connectors?",
        body:
          "The Connections page itself shows everything that is connectable today (Gmail) and what’s coming soon (Google Calendar, Stripe). A browsable directory of the full connector roadmap is rendered separately below the help center — it lists all planned integrations with their current status. The directory is the right place to check what’s live vs on the way.",
        keywords: ["directory", "connector list", "full list", "integrations", "roadmap", "coming soon"],
      },
    ],
  },

  // --- MEMORY (fully authored) ---------------------------------------------
  {
    id: "memory",
    title: "Grove Memory",
    intro:
      "Grove Memory is the shared brain your Nibbins draw on — facts, pricing, policies, voice, and hard rules you set.",
    articles: [
      {
        id: "mem-what-is",
        q: "What is Grove Memory?",
        body:
          "Grove Memory (/app/memory) is your editable business brain — shared with all your Nibbins so their drafts sound like you. It has five sections:\n• Facts — who you are, what you do, your pricing.\n• Pricing — your rates, packages, and policies.\n• Policies — how you work (payment terms, turnaround, cancellations).\n• FAQ — common questions and your standard answers.\n• Voice — paste a reply you’re proud of; your helpers learn your tone from it.\n\nPlus Hard rules: one per line, things your Nibbins can never break in a draft — e.g. “Never promise a delivery date without checking with me.” Saved memory takes effect from the next draft onward.",
        keywords: ["grove memory", "what is", "facts", "pricing", "policies", "faq", "voice", "hard rules"],
      },
      {
        id: "mem-how-built",
        q: "How is memory built?",
        body:
          "Grove Memory is built two ways:\n\n1. You write it directly. Open /app/memory and fill in any of the five sections. It’s just a text editor — paste in your pricing, your standard answers, a reply you like. Anything you write is used from the next draft.\n\n2. Agent memory — short derived facts a Nibbin learns from your approved work. When you approve a draft (or edit it), the Nibbin can extract a short note: a preference, a recurring phrasing, a pattern. These are derived notes, never raw content, and they run through redaction before storage.\n\nSemantic retrieval (finding the right memory at the right time) uses an embedding model on already-derived, already-redacted text only.",
        keywords: ["how built", "agent memory", "derived", "approved", "semantic retrieval", "embedding"],
      },
      {
        id: "mem-how-used",
        q: "How do Nibbins use memory when drafting?",
        body:
          "When a Nibbin drafts something for you, it pulls the relevant pieces of Grove Memory — your pricing, your voice, your hard rules — into context. Semantic retrieval finds the most relevant notes from both Grove Memory and agent memory.\n\nThe result: drafts that sound like you, reference your actual rates, and never break the lines you’ve set. Hard rules are treated as non-negotiable — a Nibbin will never draft something that breaks one, even if instructed to.\n\nSaved memory takes effect immediately from the next draft. If you update your pricing today, tomorrow’s draft reflects it.",
        keywords: ["how used", "drafting", "pricing", "hard rules", "non-negotiable", "relevant", "context"],
      },
      {
        id: "mem-edit-forget",
        q: "How do I edit or remove memory?",
        body:
          "Go to /app/memory. Any section is editable — just click in, change the text, and save. You can clear any section entirely.\n\nFor agent memory (the derived notes Nibbins learn from your work), each note is viewable on your Nibbin’s card under “What [name] has learned about you.” You can delete individual notes or clear all learned memory for a Nibbin from that card.\n\nDeleting a note takes effect immediately. Cleared memory is gone — the Nibbin starts fresh from whatever remains in Grove Memory.",
        keywords: ["edit", "remove", "forget", "clear", "delete note", "agent memory", "learned"],
      },
      {
        id: "mem-isolation",
        q: "Is my memory shared with anyone else?",
        body:
          "No. Memory is per-account. Your Grove Memory and your Nibbins’ learned notes are isolated to your account — no other user or Nibbin from another account can see or access them.\n\nMemory is also never used to train Nibbin’s underlying models. It lives in your account and is used only to make your drafts better.",
        keywords: ["isolation", "per account", "shared", "other users", "private", "isolated"],
      },
      {
        id: "mem-voice",
        q: "How do I teach Nibbin my writing voice?",
        body:
          "Go to /app/memory → Voice. Paste a reply or email you’re proud of — one that sounds exactly like you. You can add several examples. Your Nibbins read this when they draft, so the voice box is the fastest way to lift draft quality across all your helpers at once.\n\nAgent memory adds to this over time: as you approve drafts and edit them, your Nibbins pick up phrasing preferences and recurring patterns. Together, Grove Memory voice + agent memory means drafts get closer to your style the more you use Nibbin.",
        keywords: ["voice", "writing style", "tone", "examples", "paste", "draft quality"],
      },
      {
        id: "mem-hard-rules",
        q: "What are hard rules, and how do I set them?",
        body:
          "Hard rules are lines your Nibbins can never break in a draft, no matter what. Add them in /app/memory → Hard rules — one rule per line. Examples:\n• “Never promise a delivery date without checking with me.”\n• “Always address clients by first name.”\n• “Never mention a discount without my explicit approval.”\n\nHard rules are treated as non-negotiable at the model level. A Nibbin will refuse to draft something that breaks one, even if the task seems to call for it. Update them anytime; changes take effect from the next draft.",
        keywords: ["hard rules", "non-negotiable", "never break", "rules", "policies", "lines"],
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

  // --- FAQ (fully authored) ------------------------------------------------
  {
    id: "faq",
    title: "Frequently asked questions",
    intro: "Quick answers to the most common questions.",
    articles: [
      {
        id: "faq-what-is-nibbin",
        q: "What is Nibbin, in one line?",
        body:
          "A grove of little AI helpers that learn how you work and take routine chores off your plate — earning the right to act on their own, one approved draft at a time.",
        keywords: ["what is", "overview", "one line", "summary"],
      },
      {
        id: "faq-screen-recorded",
        q: "Is my screen recorded and sent somewhere?",
        body:
          "Screen recordings never leave your device. Only a redacted summary (the synthesis packet) can leave, and only when you choose to build your diagnosis — after you’ve reviewed it and chosen “Send to Nibbin.” Your raw recordings stay on your machine and are verifiably deleted after the packet is safely uploaded.",
        keywords: ["screen recorded", "uploaded", "sent", "leaves device", "raw recordings"],
      },
      {
        id: "faq-what-leaves-machine",
        q: "What actually leaves my machine?",
        body:
          "Only the redacted synthesis packet — and only when you choose. The packet contains categorized workflow summaries and patterns. It never contains screen recordings, raw event streams, or personally identifiable content (those are redacted before anything is written to disk).\n\nIf you choose “Delete instead” at packet review, nothing leaves.",
        keywords: ["what leaves", "machine", "packet", "synthesis", "upload", "redacted"],
      },
      {
        id: "faq-passwords-captured",
        q: "Can Nibbin capture my passwords or banking?",
        body:
          "No. Passwords and secure fields can’t be captured — by construction, never by reading the picture. Banking, health, and sensitive-category sites are also auto-excluded before anything is saved. These are architectural guarantees, not settings.",
        keywords: ["passwords", "banking", "secure fields", "captured", "by construction"],
      },
      {
        id: "faq-audio-camera",
        q: "Does Nibbin record audio or use my camera?",
        body:
          "Never. Audio and camera are permanent exclusions. There is no microphone or camera access in Nibbin, anywhere.",
        keywords: ["audio", "camera", "microphone", "record", "never"],
      },
      {
        id: "faq-model-training",
        q: "Does Nibbin train its AI on my content?",
        body:
          "No. Nibbin never trains its models on your content — ever. That’s a hard guarantee, not a setting (there is no toggle because it never happens).\n\nSeparately, a Model improvement toggle controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities and models perform — never your data, never your content, never sold. That toggle is ON by default (opt-out). Turn it off anytime in Settings → Data & Privacy.",
        keywords: ["model training", "ai", "content", "model improvement", "toggle", "opt-out", "aggregate"],
      },
      {
        id: "faq-can-i-undo",
        q: "Can I undo a Nibbin action?",
        body:
          "Until a Nibbin graduates, every action goes through you for approval first — so there’s nothing to undo if you haven’t approved it yet.\n\nFor a Graduate acting autonomously: what’s undoable depends on the action. A sent email can’t be unsent, but the Nibbin’s card shows every run in its history. If a recent run went wrong, you can put the Nibbin back to Student (one click) so everything goes back through drafts while you review.",
        keywords: ["undo", "revert", "mistake", "sent email", "graduate", "autonomy", "history"],
      },
      {
        id: "faq-mac-support",
        q: "What is the macOS status?",
        body:
          "The desktop app runs on macOS — you can sign in, view your grove, approve drafts, and manage everything from the Mac app. However, native Field Study screen capture is coming soon on macOS. Windows capture is live today.\n\nFor now, macOS users can run the Field Study once macOS capture ships.",
        keywords: ["mac", "macos", "apple", "coming soon", "screen capture", "windows", "platform"],
      },
      {
        id: "faq-agents-act-alone",
        q: "Do agents act without me?",
        body:
          "Not until they’ve earned it. Eggs observe only. Students draft everything for your approval. Seniors act on their own only for the routine patterns they’ve already proven — and only a Graduate acts fully on its own within its spec.\n\nYou can put any Nibbin back to drafts in one click. And if a Nibbin’s recent work starts getting edited, you’ll get a calm nudge asking if you want to reset it — demotion is always your call.",
        keywords: ["autonomy", "act alone", "without me", "approval", "trust", "graduate", "demotion"],
      },
      {
        id: "faq-cost-billing",
        q: "What does Nibbin cost?",
        body:
          "There’s a free tier (Hatchling) plus paid plans for more Nibbins and higher run limits. Plan details and current pricing are shown in the app. If you hit your Nibbin cap, you’ll see “Move up a plan.” Top-up credits are available if you need extra runs between billing cycles.",
        keywords: ["cost", "billing", "pricing", "plans", "free tier", "hatchling", "credits", "top-up"],
      },
      {
        id: "faq-field-study-vs-quick-scan",
        q: "Field Study vs Quick Scan — what’s the difference?",
        body:
          "Field Study = a deep 14-day observation that produces your full diagnosis across all your work. Quick Scan = capture and diagnose one task on demand, auto-stops in about 6 hours. Use Quick Scan when you want a fast read on one specific workflow right now.",
        keywords: ["field study", "quick scan", "difference", "14 day", "6 hours"],
      },
      {
        id: "faq-lite-vs-detailed",
        q: "What is Lite vs Detailed capture?",
        body:
          "Lite (live now, the default) captures app/window info and redacted text — no screenshots. Detailed (coming soon) would add periodic on-device screenshots. Lite is the right choice today; Detailed will be selectable when it ships.",
        keywords: ["lite", "detailed", "capture", "screenshots", "coming soon"],
      },
      {
        id: "faq-how-long-study",
        q: "How long does a Field Study last?",
        body:
          "A full Field Study runs 14 days and then hard-stops automatically — enforced by the observer daemon, not the UI, with an anti-rollback clock. A Quick Scan auto-stops after about 6 hours.",
        keywords: ["how long", "14 days", "hard stop", "duration", "quick scan", "6 hours"],
      },
      {
        id: "faq-what-connections",
        q: "Which tools can I connect?",
        body:
          "Today: Gmail (read-only at first; drafting scope added per Nibbin). Google Calendar and Stripe are coming soon. Other tools mentioned in the Hatch picker are on the roadmap but not connectable yet.\n\nNote: Gmail connections are tester-allowlist-gated while Google OAuth verification is pending. Request access from the Connections page if you’re not on the list.",
        keywords: ["connect", "gmail", "calendar", "stripe", "tools", "connections", "allowlist"],
      },
      {
        id: "faq-what-is-grove-memory",
        q: "What is Grove Memory?",
        body:
          "Your editable business brain — facts, pricing, policies, FAQ answers, voice, and hard rules your Nibbins can never break in a draft. Everything in Grove Memory is shared with all your helpers so their drafts sound like you. Edit or clear any section anytime at /app/memory.",
        keywords: ["grove memory", "facts", "voice", "hard rules", "pricing", "policies"],
      },
      {
        id: "faq-delete-account",
        q: "How do I delete my account?",
        body:
          "Go to Settings → Account. Type your account name to confirm, and start the 30-day cancelable countdown. Your tools disconnect immediately. You can cancel the deletion any time within those 30 days. After 30 days, everything is permanently removed and you receive a receipt.",
        keywords: ["delete account", "account deletion", "30 days", "permanent", "cancel", "receipt"],
      },
      {
        id: "faq-pause-capture",
        q: "How do I pause capture instantly?",
        body:
          "Use the global pause hotkey: ⌘⇧. on Mac or Ctrl+Shift+. on Windows. Press it from any app and capture stops near-instantly. Press it again or tap Resume in Field Study to continue. You can also pause from the Field Study → Home screen.",
        keywords: ["pause", "hotkey", "instantly", "ctrl+shift", "cmd", "stop capture"],
      },
    ],
  },
];
