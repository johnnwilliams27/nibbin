
## Retired checks

- **copylint (SPEC 14A) was retired on 2026-09-09**, not silenced. It mechanically
  enforced the v1 Nibbin brand-voice rules — chiefly the em-dash ban — and both its
  source of truth (`SPEC.md` §14A) and the `brand-voice` skill that defined those
  rules were archived with the v1 product the same day. A check enforcing a
  specification that no longer exists in the repository is worse than no check: it
  fails honestly for the wrong reason, and the only way to make it pass is to obey a
  brand nobody is using. It was red for 260 pre-existing hits at the point of
  removal, all in files committed before the pivot, and it was invisible because the
  eslint step ahead of it in the same job failed first. If the new identity ever
  acquires mechanical copy rules, write a new linter against the new spec rather than
  resurrecting this one.
