# Nibbin v1 archive

The creature/busywork productivity product — web app, desktop Observer, the
Grovekeeper, the creature engine, connectors and the scan/redaction pipeline —
was removed from the working tree here on 2026-09-09. This repository now
carries the ERC-8004 trust index.

**Nothing was deleted.** Every file and its full history remain in this
repository's git history. The last commit containing the complete v1 tree is:

    6064ced90efbda7722897faf951f2ce2e0f55559

## Recovering it

Browse it:

    git checkout 6064ced90efbda7722897faf951f2ce2e0f55559

Restore a single package into the current tree:

    git checkout 6064ced90efbda7722897faf951f2ce2e0f55559 -- packages/router

Create the standalone `old-nibbin` repository from it (run locally, needs a
GitHub account with repo-creation rights — the session integration is not
permitted to create repositories):

    gh repo create johnnwilliams27/old-nibbin --private
    git clone https://github.com/johnnwilliams27/nibbin old-nibbin
    cd old-nibbin
    git checkout -b main 6064ced90efbda7722897faf951f2ce2e0f55559
    git remote set-url origin https://github.com/johnnwilliams27/old-nibbin
    git push -u origin main

That gives `old-nibbin` the entire history with the v1 tree at its head.

## Worth salvaging before you forget it exists

Not obviously dead, and cheap to lift back out with the checkout command above:

- `packages/router` — LLM routing + the COGS ledger. The judge could use it.
- `packages/connectors` — OAuth machinery. Directly relevant to the 3,544
  auth-walled agents that need a human login.
- `packages/shared` — tokens, brand assets, shared types.

## Still live outside this repository

Removing the code does not take the product down. These remain and need a
separate decision:

- **nibbin.com** — still serving the v1 site.
- **8 Vercel cron jobs** defined in the old `apps/web/vercel.json`, including
  `account-purge` (daily) and `gmail-watch-renew`. Two of these touch real
  user data; if any deletion request is outstanding, stopping them leaves a
  data-deletion obligation unmet. Check before tearing the deployment down.
- Supabase projects, and any connected Gmail/OAuth grants held for users.

## A v1 fix landed after the archive point

`old-nibbin` was created from `b6c4159`. One v1 commit reached `main` after that:

    2607349  fix(study): tick the field-study countdown, show days, listen for
             study:status (#255)

It touches `apps/web/app/app/study/page.tsx`,
`apps/web/components/study/DesktopOrStudyCard.tsx` and
`apps/web/lib/desktop/bridge.ts`. Merging it here produced four modify/delete
conflicts — `main` edited files this branch archives — and they were resolved by
keeping the deletion, because four files importing packages that no longer exist
is not a working product, just debris.

The fix is not lost: #255 is an ancestor of `main`, so it stays in this
repository's history. Anyone reviving v1 should take it from `main` at the merge
of this pull request rather than from `b6c4159`, which predates it, and should
prefer that over the `old-nibbin` snapshot for the same reason.
