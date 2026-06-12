# MACOS-TEST-PLAN.md — Observer validation on macOS

Tester: [friend's name] · Role: macOS design partner zero · Machine: [Apple Silicon / Intel — note which]
Owner: John · Closes: M6 gate caveats ("budgets met" + <100ms pause unverified on macOS)
Time required: ~60–90 min active + one overnight idle period

## 0. Setup (John does this before handing over)

- [ ] Add tester's email to the Google OAuth test-mode allowlist
- [ ] Create their account invite (or have them sign up via magic link on the dev env)
- [ ] Send the dev build + this file
- [ ] Tell them: the app is unsigned until our Apple Developer ID lands — Gatekeeper friction
      below is EXPECTED and disappears at signing. Nothing they capture leaves their machine;
      raw captures are local-only by architecture (they can verify this themselves in §3.4).

### Gatekeeper bypass for the unsigned dev build
Right-click the app → Open → Open. If macOS still refuses:
`xattr -cr /Applications/Nibbin.app` in Terminal, then open normally.
(System Settings → Privacy & Security → "Open Anyway" also works on newer macOS.)

---

## 1. What we're actually testing (context for the tester)

Nibbin's desktop Observer runs a strictly time-boxed 14-day "study" of how you work, with
all screen data captured, redacted, and stored ONLY on your machine. Your job is to verify
the macOS-specific behavior: the permission flows, that performance stays polite, that
pause/stop controls feel instant, and that deletion really deletes. Break it if you can —
finding problems is the job, not a courtesy.

## 2. The permission gauntlet (highest value)

- [ ] **First-run rehearsal:** the app should walk you through Screen Recording +
      Accessibility permissions with System Settings deep links BEFORE any study can start.
      Note anything confusing — wording, ordering, where you hesitated.
- [ ] **The revocation test (most important single test):** start a short study, then go to
      System Settings → Privacy & Security → Screen Recording and REVOKE the permission
      mid-study. PASS: the app detects it promptly and auto-pauses with a calm explainer.
      FAIL: it keeps "running" while silently capturing nothing, or crashes.
- [ ] Re-grant the permission. PASS: a clear path to resume; no silent auto-resume without
      telling you.
- [ ] Quit and relaunch mid-study: state should survive (still paused/running as you left it).

## 3. Core behaviors

### 3.1 Performance budgets (M6 caveat)
- [ ] During an active study with normal use (browser + a heavy app), check Activity
      Monitor: note Nibbin's CPU % (sustained, not spikes) and memory. Capture numbers.
- [ ] Fan noise / heat / battery drain notably worse than normal? Note it.
- [ ] Overnight idle with study paused: any background CPU creep or memory growth by morning?

### 3.2 Pause latency (M6 caveat)
- [ ] Hit pause from the tray/menu-bar control repeatedly. PASS: feels instantaneous
      (<100ms — i.e., no perceptible lag between click and the paused state showing).
- [ ] Pause via the in-app button too; both paths should feel identical.

### 3.3 Study lifecycle
- [ ] Start a study; confirm the day counter and what-it's-doing status are honest.
- [ ] Pause → resume → pause. Abort a study entirely. PASS: abort asks for confirmation,
      then verifiably stops (no capture indicators, Activity Monitor quiet).
- [ ] **Deletion verifier:** after aborting, run the in-app "verify deletion" flow.
      PASS: it reports the local store empty and you can see store size at ~zero.

### 3.4 Redaction spot-check (trust check)
- [ ] With a study running, open a page showing a fake card number (e.g., a test credit
      card number like 4242 4242 4242 4242) and an email address on screen.
- [ ] Open the local review UI afterward. PASS: the number appears scrubbed/masked in
      anything stored; FAIL: visible card digits anywhere in the review surface.
- [ ] Bonus (technical testers): with the study running, watch Activity Monitor → Network
      for the Nibbin process. Raw capture should generate NO meaningful upload traffic.

### 3.5 macOS daily-life edges
- [ ] Close the laptop lid mid-study (sleep), reopen after 10+ min. PASS: clean resume or
      clearly-stated pause; no crash, no corrupted state.
- [ ] Second display: plug/unplug an external monitor mid-study. Note any glitches.
- [ ] Exclusions: add an app or browser tab to the exclusion list, use it, then confirm
      nothing from it appears in the review UI.

## 4. Session script (the design-partner half)

Do this part in one sitting and time it — John needs the numbers, not impressions.

1. START STOPWATCH. Sign up / sign in on the web app.
2. Connect one real account when prompted (Gmail is fine — read-only scopes; revocable
   anytime at myaccount.google.com).
3. Follow onboarding to your first agent: scan → recommendation → adopt → first draft
   appears → you approve or edit it.
4. STOP STOPWATCH at first approved draft. Record the minutes — this is TTFAD, the number
   on our landing page, measured on your machine.
5. Then install the desktop app and run §2–§3 above.

## 5. Capture sheet (send this back)

| Item | Result |
|---|---|
| Machine (model, chip, macOS version) | |
| TTFAD (signup → first approved draft, minutes) | |
| Where you hesitated during onboarding (be specific) | |
| Permission flow: confusing moments | |
| Revocation test: pass/fail + what you saw | |
| CPU % sustained during study / memory | |
| Pause latency: instant or laggy? | |
| Abort + deletion verifier: pass/fail | |
| Redaction spot-check: pass/fail | |
| Sleep/wake + display tests: notes | |
| The one thing you'd fix first | |
| Would you let this run for 14 days on your machine? Why/why not? | |

## 6. What happens with the results

Findings file as issues against the M6 caveats; the two numeric caveats (budgets, <100ms
pause) close only with this sheet's numbers. The TTFAD + hesitation notes feed M7 prep and
the onboarding fixes before design partners arrive. If anything in §3.4 fails, it's a P0 —
message John immediately, before finishing the rest.
