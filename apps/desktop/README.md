# apps/desktop — the Observer

Tauri desktop client (macOS first; Windows behind the same capture trait). Built at M6.

Scope (SPEC §5): capture → redaction → SQLCipher store → study lifecycle controller →
review UI → local Field Notes. Sign-up/sign-in via system browser + deep link.

Hard rules before any code lands here:
- C1: raw frames/thumbnails/OCR crops never leave the device — the capture module has
  no network dependency, by construction.
- C2: hard auto-stop at day 14, enforced in the capture daemon, not the UI.
- C4: secure input fields suppressed via OS flags, never image detection.
- C6: global pause hotkey kills capture in <100ms.
- Redaction corpus (tests/redaction-corpus) is CI-blocking and P0.

See `.claude/skills/redaction-corpus` and `docs/INVARIANTS.md` before starting.
