# GOTCHAS — traps already paid for (append; newest first)

- Landing-page reveal system assigns .reveal from a JS selector config; adding the
  class by hand in markup leaves elements at opacity:0 forever (invisible but taking
  layout space — looks like mystery whitespace). Register selectors in the groups
  array instead.
- Creature v2: Keeper ignores all customization args by design — tests must not treat
  the always-coral blush as a palette leak (blush is brand-constant on every species).
- Creature v2: cel shading uses per-instance clipPath ids; like gradients, duplicate
  ids across instances corrupt rendering — always route through mass()/_uid.
- Creature engine: every render must generate unique SVG gradient IDs; duplicate defs
  IDs across instances silently recolor creatures.
- prefers-reduced-motion must yield feature parity, never hidden content; reveal systems
  may not depend on JS or motion to make content visible.
- Redaction fail-closed: if the Presidio sidecar is down, do NOT persist unredacted
  strings; the Rust regex battery runs regardless, and persistence blocks on layer 3.
- Scripted batch edits: a failed assertion mid-script means earlier replacements in that
  run never persisted — verify file state after any aborted batch.
- Google restricted scopes (gmail.readonly and up) trigger OAuth verification + annual
  CASA assessment with weeks-to-months lead time; unverified apps cap at 100 users.
