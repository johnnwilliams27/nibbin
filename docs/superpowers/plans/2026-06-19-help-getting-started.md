# Help & Getting-Started Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an authenticated `/app/help` Help & Getting-Started hub — searchable product docs (all features, tips, constraints, setup, best practices, FAQ), an interactive activation checklist that reads live account state, a Telegram chat setup guide, and a comprehensive connector directory (live + early-access + 150+ coming-soon) with real Clearbit logos — reusing the directory on the Connections page.

**Architecture:** A single content model (`lib/help/content.ts`) drives a server-rendered page (`app/app/help/page.tsx`) wrapped in a client `HelpHub` for live search/filter. The checklist is computed server-side from Supabase (`lib/help/checklist.ts`) and rendered into a client component. The connector directory is a shared component (`components/help/ConnectorDirectory.tsx`) reading one catalog (`lib/connections/catalog.ts`), used by both `/app/help` and `/app/connections`. Logos load from Clearbit by brand domain with a monogram fallback. All authored copy comes from `docs/help-compendium.md` (the authoritative, claims-audited content source).

**Tech Stack:** Next.js App Router (RSC + client components), TypeScript, Supabase (`@supabase/ssr`), CSS Modules + design tokens (`packages/shared/tokens.css`), Vitest for unit tests, the existing UI kit (`apps/web/components/ui`).

## Global Constraints

- **Content source of truth:** all user-facing copy is taken from `C:/nib-help/docs/help-compendium.md` and the catalog's `whatItDoes`. Do not invent product claims.
- **Privacy/claims accuracy (claims-auditor will check — copy these EXACT framings):**
  - Model training: "Nibbin never trains its models on your content — ever. That's a hard guarantee, not a setting (there is no toggle because it never happens)." The separate **Model improvement** toggle governs only anonymized, aggregate performance signals, never content, never sold, and is **ON by default (opt-out)**. Never write "off by default" for that toggle.
  - Pause hotkey: "stops capture near-instantly." NEVER publish "<100ms".
  - Secure fields: "passwords and secure fields can't be captured — by construction, never by reading the picture." Do not claim an OS-flag mechanism.
  - Capture is local/on-device; only redacted, user-initiated packets ever leave the machine; deletion is verified with a receipt.
- **Connector status truth:** only `gmail` is `live`. The `early_access` set is fixed (engine-ready, not yet UI-wired); everything else is `coming_soon`. Connecting any provider is gated by a tester allowlist — non-testers see a "Request access" affordance, not a broken connect.
- **Voice:** Nibbin brand voice — warm, plain, concrete, no hype, no em-dash-required, no "seamlessly". Match `docs/help-compendium.md`.
- **Styling:** CSS Modules + tokens only (no hardcoded hex). Use `var(--moss)`, `var(--ink)`, `var(--paper)`, `var(--r-card)`, fonts `var(--display)/var(--sans)/var(--mono)`. Reuse `components/ui` primitives (`Card`, `Button`, `Badge`, `Select`, `Spinner`, `InlineFeedback`).
- **Auth:** every `/app/*` page calls `appSession()` from `apps/web/lib/auth/app-session.ts` and uses `export const dynamic = 'force-dynamic'`.
- **Tests:** Vitest. Run a single test file with `npx vitest run <path>` from `apps/web`. Keep tests behavior-focused; no asserts-nothing tests.
- **Sensitive path:** this PR touches privacy claims + connection surfaces → the 4-reviewer adversarial gate runs before merge (red-team / claims-auditor / logic-skeptic / cost-auditor). Land via feature branch + PR to `main`; set `gh pr merge --auto --squash`.

---

## File Structure

**Data / logic (pure, unit-tested):**
- `apps/web/lib/connections/catalog.ts` — `CONNECTORS`, `CONNECTOR_CATEGORIES`, `ConnectorEntry`, `ConnectorStatus` (authored by a research agent; this plan validates + extends it).
- `apps/web/lib/connections/catalog-view.ts` — `sortConnectors()`, `groupConnectors()`, `STATUS_ORDER`, `monogramFor()`.
- `apps/web/lib/help/types.ts` — `HelpArticle`, `HelpSection`, `HelpContent`.
- `apps/web/lib/help/content.ts` — `HELP_CONTENT: HelpContent` (all sections), `filterHelp()`.
- `apps/web/lib/help/checklist.ts` — `getChecklistState()`, `ChecklistStep`, `ChecklistState`.

**Components:**
- `apps/web/components/help/ConnectorLogo.tsx` — Clearbit `<img>` + monogram fallback.
- `apps/web/components/help/ConnectorDirectory.tsx` — grouped, sortable grid (shared).
- `apps/web/components/help/HelpAccordion.tsx` — collapsible article.
- `apps/web/components/help/HelpSearch.tsx` — search input + result filtering.
- `apps/web/components/help/GettingStartedChecklist.tsx` — checklist UI.
- `apps/web/components/help/HelpHub.tsx` — client shell composing search + sections + checklist + directory.
- `apps/web/components/help/help.module.css` — all styles.
- `apps/web/components/shell/HelpButton.tsx` — topbar "?" link to `/app/help`.

**Pages / integration:**
- `apps/web/app/app/help/page.tsx` — server page.
- `apps/web/components/shell/AppShell.tsx` — add `help` nav entry + icon + `HelpButton`.
- `apps/web/app/app/connections/page.tsx` — embed `ConnectorDirectory` roadmap.
- `apps/web/next.config.*` (or the header/CSP source) — allow `logo.clearbit.com` in `img-src`.

**Content source (not shipped code):**
- `docs/help-compendium.md` — authored compendium (already produced).

---

### Task 1: Connector catalog validation + view helpers

**Files:**
- Modify/verify: `apps/web/lib/connections/catalog.ts` (created by research agent)
- Create: `apps/web/lib/connections/catalog-view.ts`
- Test: `apps/web/lib/connections/catalog-view.test.ts`, `apps/web/lib/connections/catalog.test.ts`

**Interfaces:**
- Consumes: `catalog.ts` exports `ConnectorEntry { id: string; name: string; category: string; status: ConnectorStatus; whatItDoes: string; domain: string | null }`, `ConnectorStatus = 'live' | 'early_access' | 'coming_soon'`, `CONNECTORS: ConnectorEntry[]`, `CONNECTOR_CATEGORIES: string[]`.
- Produces: `STATUS_ORDER: Record<ConnectorStatus, number>`; `sortConnectors(list: ConnectorEntry[], mode: 'available' | 'alpha'): ConnectorEntry[]`; `groupConnectors(list: ConnectorEntry[]): { category: string; items: ConnectorEntry[] }[]`; `monogramFor(name: string): string`.

- [ ] **Step 1: Write the failing catalog invariants test**

```ts
// apps/web/lib/connections/catalog.test.ts
import { describe, it, expect } from 'vitest';
import { CONNECTORS, CONNECTOR_CATEGORIES } from './catalog';

describe('connector catalog', () => {
  it('has at least 150 entries', () => {
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(150);
  });
  it('has unique ids', () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('uses only declared categories', () => {
    const set = new Set(CONNECTOR_CATEGORIES);
    for (const c of CONNECTORS) expect(set.has(c.category)).toBe(true);
  });
  it('marks exactly Gmail as live', () => {
    expect(CONNECTORS.filter((c) => c.status === 'live').map((c) => c.id)).toEqual(['gmail']);
  });
  it('gives every non-rail a domain for logos', () => {
    const rails = new Set(['imap-smtp', 'caldav', 'generic-mcp', 'webhook-rail', 'csv-import']);
    for (const c of CONNECTORS) {
      if (!rails.has(c.id)) expect(c.domain, `${c.id} needs a domain`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it — verify it passes or surfaces real catalog defects**

Run: `cd apps/web && npx vitest run lib/connections/catalog.test.ts`
Expected: PASS. If it fails, fix the data in `catalog.ts` (e.g., a missing domain, a stray `live`/`early_access`, a category typo) — the catalog was machine-generated and this test is its acceptance gate. Do not weaken the test to pass.

- [ ] **Step 3: Write the failing view-helper test**

```ts
// apps/web/lib/connections/catalog-view.test.ts
import { describe, it, expect } from 'vitest';
import { sortConnectors, groupConnectors, monogramFor } from './catalog-view';
import type { ConnectorEntry } from './catalog';

const mk = (id: string, name: string, category: string, status: ConnectorEntry['status']): ConnectorEntry =>
  ({ id, name, category, status, whatItDoes: 'x', domain: `${id}.com` });

describe('sortConnectors', () => {
  const list = [
    mk('z', 'Zeta', 'Email', 'coming_soon'),
    mk('a', 'Alpha', 'Email', 'coming_soon'),
    mk('g', 'Gmail', 'Email', 'live'),
    mk('e', 'Echo', 'Email', 'early_access'),
  ];
  it('available mode puts live+early_access first, then alpha within tier', () => {
    expect(sortConnectors(list, 'available').map((c) => c.id)).toEqual(['g', 'e', 'a', 'z']);
  });
  it('alpha mode sorts purely by name', () => {
    expect(sortConnectors(list, 'alpha').map((c) => c.id)).toEqual(['a', 'e', 'g', 'z']);
  });
});

describe('groupConnectors', () => {
  it('groups by category in CONNECTOR_CATEGORIES order and sorts items available-first', () => {
    const groups = groupConnectors([
      mk('a', 'Alpha', 'Payments & Invoicing', 'coming_soon'),
      mk('g', 'Gmail', 'Email', 'live'),
    ]);
    expect(groups[0].category).toBe('Email');
    expect(groups.find((g) => g.category === 'Payments & Invoicing')?.items[0].id).toBe('a');
  });
  it('omits empty categories', () => {
    const groups = groupConnectors([mk('g', 'Gmail', 'Email', 'live')]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('monogramFor', () => {
  it('returns up to 2 uppercase initials', () => {
    expect(monogramFor('Google Calendar')).toBe('GC');
    expect(monogramFor('Stripe')).toBe('ST');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd apps/web && npx vitest run lib/connections/catalog-view.test.ts`
Expected: FAIL ("Cannot find module './catalog-view'").

- [ ] **Step 5: Implement the view helpers**

```ts
// apps/web/lib/connections/catalog-view.ts
import { CONNECTOR_CATEGORIES, type ConnectorEntry, type ConnectorStatus } from './catalog';

export const STATUS_ORDER: Record<ConnectorStatus, number> = {
  live: 0,
  early_access: 1,
  coming_soon: 2,
};

export function sortConnectors(list: ConnectorEntry[], mode: 'available' | 'alpha'): ConnectorEntry[] {
  const byName = (a: ConnectorEntry, b: ConnectorEntry) => a.name.localeCompare(b.name);
  if (mode === 'alpha') return [...list].sort(byName);
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b));
}

export function groupConnectors(list: ConnectorEntry[]): { category: string; items: ConnectorEntry[] }[] {
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    items: sortConnectors(list.filter((c) => c.category === category), 'available'),
  })).filter((g) => g.items.length > 0);
}

export function monogramFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
```

- [ ] **Step 6: Run both test files — verify PASS**

Run: `cd apps/web && npx vitest run lib/connections/catalog.test.ts lib/connections/catalog-view.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/connections/catalog.ts apps/web/lib/connections/catalog-view.ts apps/web/lib/connections/catalog.test.ts apps/web/lib/connections/catalog-view.test.ts
git commit -m "feat(help): connector catalog invariants + sort/group view helpers"
```

---

### Task 2: ConnectorLogo (Clearbit + monogram fallback) + CSP allowance

**Files:**
- Create: `apps/web/components/help/ConnectorLogo.tsx`
- Create: `apps/web/components/help/help.module.css`
- Modify: the project's CSP `img-src` source (locate it — search `img-src` and `Content-Security-Policy` under `apps/web` in `next.config.*`, `middleware.ts`, or a headers helper)
- Test: `apps/web/components/help/ConnectorLogo.test.tsx`

**Interfaces:**
- Consumes: `monogramFor` from `lib/connections/catalog-view`.
- Produces: `ConnectorLogo({ name, domain }: { name: string; domain: string | null })` — renders `<img src="https://logo.clearbit.com/{domain}">` when `domain` is set, swapping to a monogram tile on error or when `domain` is null. Exposes `clearbitUrl(domain: string): string`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/help/ConnectorLogo.test.tsx
import { describe, it, expect } from 'vitest';
import { clearbitUrl } from './ConnectorLogo';

describe('clearbitUrl', () => {
  it('builds a Clearbit logo URL from a domain', () => {
    expect(clearbitUrl('stripe.com')).toBe('https://logo.clearbit.com/stripe.com');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run components/help/ConnectorLogo.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement ConnectorLogo**

```tsx
// apps/web/components/help/ConnectorLogo.tsx
'use client';
import { useState } from 'react';
import { monogramFor } from '../../lib/connections/catalog-view';
import styles from './help.module.css';

export function clearbitUrl(domain: string): string {
  return `https://logo.clearbit.com/${domain}`;
}

export function ConnectorLogo({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return <span className={styles.logoFallback} aria-hidden="true">{monogramFor(name)}</span>;
  }
  return (
    <img
      className={styles.logo}
      src={clearbitUrl(domain)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={28}
      height={28}
      onError={() => setFailed(true)}
    />
  );
}
```

- [ ] **Step 4: Add the logo styles to `help.module.css`**

```css
/* apps/web/components/help/help.module.css */
.logo { width: 28px; height: 28px; object-fit: contain; border-radius: var(--r-input); }
.logoFallback {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--r-input);
  background: var(--understory); color: var(--ink-soft);
  font-family: var(--mono); font-size: 11px; font-weight: 600;
}
```

- [ ] **Step 5: Allow Clearbit in CSP**

Locate the `img-src` directive (grep `img-src` in `apps/web`). Add `https://logo.clearbit.com` to it. If the project uses Next `images.remotePatterns` and you switch to `next/image` later, also add `{ protocol: 'https', hostname: 'logo.clearbit.com' }` — but this plan uses a plain `<img>`, so only the CSP `img-src` change is required. If no CSP is found in `apps/web`, note that in the task report (nothing to change).

- [ ] **Step 6: Run the test — verify PASS**

Run: `cd apps/web && npx vitest run components/help/ConnectorLogo.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/help/ConnectorLogo.tsx apps/web/components/help/help.module.css apps/web/components/help/ConnectorLogo.test.tsx
git commit -m "feat(help): ConnectorLogo with Clearbit + monogram fallback; allow logo.clearbit.com in CSP"
```

---

### Task 3: ConnectorDirectory (grouped, sortable grid)

**Files:**
- Create: `apps/web/components/help/ConnectorDirectory.tsx`
- Modify: `apps/web/components/help/help.module.css`
- Test: covered by Task 1 helpers; add a render smoke test `apps/web/components/help/ConnectorDirectory.test.tsx`

**Interfaces:**
- Consumes: `CONNECTORS` (or a passed `connectors` prop), `groupConnectors`, `sortConnectors`, `ConnectorLogo`.
- Produces: `ConnectorDirectory({ connectors?, heading?, showSort? }: { connectors?: ConnectorEntry[]; heading?: string; showSort?: boolean })`.

- [ ] **Step 1: Write the failing render test**

```tsx
// apps/web/components/help/ConnectorDirectory.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectorDirectory } from './ConnectorDirectory';

describe('ConnectorDirectory', () => {
  it('renders category headings and connector names', () => {
    render(
      <ConnectorDirectory
        connectors={[
          { id: 'gmail', name: 'Gmail', category: 'Email', status: 'live', whatItDoes: 'x', domain: 'gmail.com' },
        ]}
      />,
    );
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('Gmail')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run components/help/ConnectorDirectory.test.tsx`
Expected: FAIL (module not found). (If `@testing-library/react` is absent, confirm via `package.json`; if missing, skip the render test and instead assert `groupConnectors` output shape — do not add a new dependency.)

- [ ] **Step 3: Implement ConnectorDirectory**

```tsx
// apps/web/components/help/ConnectorDirectory.tsx
'use client';
import { useState } from 'react';
import { CONNECTORS, type ConnectorEntry } from '../../lib/connections/catalog';
import { groupConnectors, sortConnectors } from '../../lib/connections/catalog-view';
import { ConnectorLogo } from './ConnectorLogo';
import { Badge } from '../ui';
import styles from './help.module.css';

const STATUS_LABEL: Record<ConnectorEntry['status'], { label: string; tone: 'moss' | 'sky' | 'neutral' }> = {
  live: { label: 'Available', tone: 'moss' },
  early_access: { label: 'Early access', tone: 'sky' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
};

export function ConnectorDirectory({
  connectors = CONNECTORS,
  heading = 'All connectors',
  showSort = true,
}: {
  connectors?: ConnectorEntry[];
  heading?: string;
  showSort?: boolean;
}) {
  const [mode, setMode] = useState<'available' | 'alpha'>('available');
  const groups = mode === 'available'
    ? groupConnectors(connectors)
    : [{ category: 'All', items: sortConnectors(connectors, 'alpha') }];

  return (
    <section className={styles.directory}>
      <header className={styles.directoryHead}>
        <h2>{heading}</h2>
        {showSort && (
          <label className={styles.sort}>
            Sort
            <select value={mode} onChange={(e) => setMode(e.target.value as 'available' | 'alpha')}>
              <option value="available">Available first, then A–Z</option>
              <option value="alpha">A–Z</option>
            </select>
          </label>
        )}
      </header>
      {groups.map((g) => (
        <div key={g.category} className={styles.group}>
          <h3>{g.category}</h3>
          <ul className={styles.grid}>
            {g.items.map((c) => (
              <li key={c.id} className={styles.card}>
                <ConnectorLogo name={c.name} domain={c.domain} />
                <div className={styles.cardBody}>
                  <div className={styles.cardName}>{c.name}</div>
                  <p className={styles.cardDesc}>{c.whatItDoes}</p>
                </div>
                <Badge tone={STATUS_LABEL[c.status].tone}>{STATUS_LABEL[c.status].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Add directory styles to `help.module.css`**

```css
.directory { margin-top: 24px; }
.directoryHead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.sort { font-size: 13px; color: var(--ink-soft); display: inline-flex; gap: 6px; align-items: center; }
.group { margin-top: 16px; }
.group h3 { font-family: var(--display); font-size: 15px; margin: 16px 0 8px; }
.grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.card { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--understory); border-radius: var(--r-card); background: var(--paper); }
.cardBody { flex: 1; min-width: 0; }
.cardName { font-weight: 600; font-size: 14px; }
.cardDesc { margin: 2px 0 0; font-size: 12px; color: var(--ink-soft); }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
```

(Confirm `Badge` accepts a `sky` tone; valid tones are neutral/moss/honey/coral/sky per the UI kit. Use `neutral` for coming_soon.)

- [ ] **Step 5: Run the render test — verify PASS**

Run: `cd apps/web && npx vitest run components/help/ConnectorDirectory.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/help/ConnectorDirectory.tsx apps/web/components/help/help.module.css apps/web/components/help/ConnectorDirectory.test.tsx
git commit -m "feat(help): grouped + sortable ConnectorDirectory with status badges"
```

---

### Task 4: Help content model + search helper

**Files:**
- Create: `apps/web/lib/help/types.ts`
- Create: `apps/web/lib/help/content.ts`
- Test: `apps/web/lib/help/content.test.ts`

**Interfaces:**
- Produces: `HelpArticle { id: string; q: string; body: string; keywords?: string[] }`; `HelpSection { id: string; title: string; intro?: string; articles: HelpArticle[] }`; `HelpContent = HelpSection[]`; `HELP_CONTENT: HelpContent`; `filterHelp(query: string, content: HelpContent): HelpContent` (returns sections containing matching articles, each trimmed to matches; empty query returns all).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/help/content.test.ts
import { describe, it, expect } from 'vitest';
import { HELP_CONTENT, filterHelp } from './content';

describe('HELP_CONTENT', () => {
  it('has unique section ids and non-empty articles', () => {
    const ids = HELP_CONTENT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_CONTENT) {
      expect(s.articles.length).toBeGreaterThan(0);
      for (const a of s.articles) {
        expect(a.q.length).toBeGreaterThan(0);
        expect(a.body.length).toBeGreaterThan(0);
      }
    }
  });
  it('covers the required sections', () => {
    const ids = new Set(HELP_CONTENT.map((s) => s.id));
    for (const req of ['getting-started', 'field-study', 'privacy', 'agents', 'connections', 'memory', 'channels', 'faq']) {
      expect(ids.has(req), `missing section ${req}`).toBe(true);
    }
  });
  it('never publishes the dropped "<100ms" claim', () => {
    const all = JSON.stringify(HELP_CONTENT);
    expect(all.includes('100ms')).toBe(false);
  });
});

describe('filterHelp', () => {
  it('returns all sections for an empty query', () => {
    expect(filterHelp('', HELP_CONTENT).length).toBe(HELP_CONTENT.length);
  });
  it('matches across question, body and keywords', () => {
    const res = filterHelp('telegram', HELP_CONTENT);
    expect(res.some((s) => s.articles.some((a) => /telegram/i.test(a.q + a.body + (a.keywords || []).join(' '))))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run lib/help/content.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create types**

```ts
// apps/web/lib/help/types.ts
export interface HelpArticle { id: string; q: string; body: string; keywords?: string[]; }
export interface HelpSection { id: string; title: string; intro?: string; articles: HelpArticle[]; }
export type HelpContent = HelpSection[];
```

- [ ] **Step 4: Implement `filterHelp` + a content skeleton with the first two sections fully written**

Implement `filterHelp` and define `HELP_CONTENT` with the 8 section shells (ids: `getting-started`, `field-study`, `privacy`, `agents`, `connections`, `memory`, `channels`, `faq`) — fully author `getting-started` and `channels` now (the rest are filled in Task 5). Pull copy from `docs/help-compendium.md`. The `channels` section MUST include the Telegram setup guide and SMS/WhatsApp-coming-soon (see Task 5 for the exact required Telegram content).

```ts
// apps/web/lib/help/content.ts
import type { HelpContent } from './types';

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
  // getting-started and channels authored here; remaining shells filled in Task 5.
];
```

- [ ] **Step 5: Run the test — `getting-started`/`channels` present, others may fail the "required sections" assertion until Task 5**

Run: `cd apps/web && npx vitest run lib/help/content.test.ts`
Expected: the unique-ids, `<100ms`, and `filterHelp` tests PASS. The "covers required sections" test will pass only once all 8 shells exist — add all 8 shells now (even if only two are fully authored) so it passes, then enrich the rest in Task 5.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/help/types.ts apps/web/lib/help/content.ts apps/web/lib/help/content.test.ts
git commit -m "feat(help): help content model, filterHelp, getting-started + channels sections"
```

---

### Task 5: Author the full content (all sections, from the compendium)

**Files:**
- Modify: `apps/web/lib/help/content.ts`
- Test: `apps/web/lib/help/content.test.ts` (already written in Task 4)

**Interfaces:** unchanged (fills out `HELP_CONTENT`).

This task is content-heavy. Read `docs/help-compendium.md` in full and author every section's articles. Required coverage (each must be a section with multiple articles):

- **getting-started** (done in Task 4): the install→study→diagnosis→grove→agents arc, the activation checklist explained, what to do first.
- **field-study**: Field Study vs Quick Scan; Lite mode (default) vs Detailed (coming soon, non-selectable); 14-day window, pause/resume (the pause "stops capture near-instantly"); Field Notes / review; exclusions; idle suspend; the daemon; deleting a study + the C3 receipt.
- **privacy**: capture is local/on-device; redacted, user-initiated packets only; review-before-upload; durable exclusions (fail-closed); verified deletion + receipt; sensitive-category blocklist; secure fields ("can't be captured — by construction, never by reading the picture"); the two-part model-training statement (content never trained on — hard guarantee, no toggle; "Model improvement" anonymized-aggregate toggle ON by default / opt-out); no telemetry.
- **agents**: Agent Shop (the 6 ready-mades — Sweep/Echo/Scribe/Brief/Tally/Hopper); adopt → Egg (supervised, draft-approval) → Agent School (25 runs, 95% clean) → Senior → Graduate; Composer (build/edit custom agent specs from your diagnosis); Training mode (opt-in, time-boxed); draft approval / how acting-on-your-behalf works; runaway prevention.
- **connections**: what connections do; Gmail live (tester-allowlist) + early-access set + "request access" for non-testers; read vs per-Nibbin write scopes; the full directory lives below (link to it); privacy of connected data.
- **memory**: facts / voice / hard rules; how memory is built and used (RAG); editing/forgetting; per-account isolation.
- **channels** (done in Task 4 — verify it contains the Telegram content below):
  - Telegram is a **two-way conversational channel** (notifications + inline Approve/Reject buttons; ask the Keeper status questions; start work from chat with plan-preview → approval; type "cancel" to stop).
  - **Telegram setup guide (numbered):** Settings → Data & Privacy → "Where your grove reaches you" → Connect Telegram → it deep-links to `t.me/<bot>?start=<nonce>` bound to your authenticated session → tap Start in Telegram → return to settings, row shows "Connected". Disconnect from the same row.
  - Safety: secrets never traverse a channel — anything needing a password/credential sends a link back to the app.
  - Channel preferences: enable/disable, urgency threshold, quiet hours, digest mode; delivery falls back to the in-app notification center.
  - **SMS and WhatsApp are coming soon** (built, compliance-gated: SMS on 10DLC registration; WhatsApp on Meta verification). Email is always available.
- **faq**: the common questions distilled from the compendium (cost/billing basics, "is my screen recorded?", "what leaves my machine?", "can I undo?", "Mac support" status, "do agents act without me?", etc.).
- Optionally add **tips** (best-practices / "get the most out of Nibbin") and **glossary** sections if the compendium provides them.

- [ ] **Step 1: Author all remaining sections in `content.ts`** (real copy from the compendium; keywords for searchability).
- [ ] **Step 2: Run the content test — verify PASS**

Run: `cd apps/web && npx vitest run lib/help/content.test.ts`
Expected: PASS (all, including required-sections + `<100ms` absence).

- [ ] **Step 3: Grep for banned/over-claim phrasings**

Run: `cd apps/web && grep -rnE "100ms|off by default|via OS flag|image detection" lib/help/content.ts || echo CLEAN`
Expected: `CLEAN` (or only correct usages). Fix any hit to match the Global Constraints framings.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/help/content.ts
git commit -m "feat(help): author all help sections from the content compendium"
```

---

### Task 6: HelpSearch + HelpAccordion

**Files:**
- Create: `apps/web/components/help/HelpSearch.tsx`
- Create: `apps/web/components/help/HelpAccordion.tsx`
- Modify: `apps/web/components/help/help.module.css`
- Test: `apps/web/components/help/HelpAccordion.test.tsx`

**Interfaces:**
- `HelpAccordion({ article }: { article: HelpArticle })` — collapsible `<details>`-based article (question as summary, body rendered). Open by default when there's an active search match (controlled via an `open` prop).
- `HelpSearch({ value, onChange }: { value: string; onChange: (v: string) => void })` — controlled input.
- Consumes: `HelpArticle` from `lib/help/types`.

- [ ] **Step 1: Write the failing test for HelpAccordion**

```tsx
// apps/web/components/help/HelpAccordion.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelpAccordion } from './HelpAccordion';

describe('HelpAccordion', () => {
  it('renders the question and body', () => {
    render(<HelpAccordion article={{ id: 'a', q: 'How do I start?', body: 'Install the app.' }} />);
    expect(screen.getByText('How do I start?')).toBeTruthy();
    expect(screen.getByText('Install the app.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** `cd apps/web && npx vitest run components/help/HelpAccordion.test.tsx` → FAIL.

- [ ] **Step 3: Implement both components**

```tsx
// apps/web/components/help/HelpAccordion.tsx
'use client';
import type { HelpArticle } from '../../lib/help/types';
import styles from './help.module.css';

export function HelpAccordion({ article, open }: { article: HelpArticle; open?: boolean }) {
  return (
    <details className={styles.article} open={open}>
      <summary className={styles.articleQ}>{article.q}</summary>
      <div className={styles.articleBody}>
        {article.body.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </details>
  );
}
```

```tsx
// apps/web/components/help/HelpSearch.tsx
'use client';
import styles from './help.module.css';

export function HelpSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className={styles.search}
      type="search"
      placeholder="Search help — features, setup, privacy, connectors…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Search help"
    />
  );
}
```

- [ ] **Step 4: Add styles** (`.article`, `.articleQ`, `.articleBody`, `.search`) to `help.module.css` using tokens (search input full-width, `var(--r-input)`, border `var(--understory)`).

- [ ] **Step 5: Run the test — verify PASS.** `cd apps/web && npx vitest run components/help/HelpAccordion.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/help/HelpSearch.tsx apps/web/components/help/HelpAccordion.tsx apps/web/components/help/help.module.css apps/web/components/help/HelpAccordion.test.tsx
git commit -m "feat(help): HelpSearch + HelpAccordion"
```

---

### Task 7: Getting-Started checklist — live state + component

**Files:**
- Create: `apps/web/lib/help/checklist.ts`
- Create: `apps/web/components/help/GettingStartedChecklist.tsx`
- Modify: `apps/web/components/help/help.module.css`
- Test: `apps/web/lib/help/checklist.test.ts`

**Interfaces:**
- Produces: `ChecklistStep { id: string; label: string; done: boolean; href: string; detail: string; auto: boolean }`; `ChecklistState { steps: ChecklistStep[]; completed: number; total: number }`; `getChecklistState(supabase: SupabaseClient, accountId: string): Promise<ChecklistState>`.
- Consumes: a Supabase client + `accountId` (from `appSession()`).

Live signals (confirmed in the codebase):
- **Account created** — always `done: true`.
- **Desktop installed / study run** — inferred: `done` if a diagnosis exists OR an `onboarding_handoff` row with `status='claimed'` exists. `auto: false` (best-effort inference; the daemon is local-only).
- **Diagnosis ready** — `diagnoses` row for `account_id` with `map.workflows.length > 0`.
- **A connection active** — `connections` row with `status='active'`.
- **Adopted a nibbin** — `nibbins` row with `kind='specialist'` and `status='active'`.

- [ ] **Step 1: Write the failing test (mock the Supabase client)**

```ts
// apps/web/lib/help/checklist.test.ts
import { describe, it, expect } from 'vitest';
import { getChecklistState } from './checklist';

// Minimal chainable Supabase stub: each from(table) returns canned rows.
function stub(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = tables[table] || [];
      const api: any = {
        select: () => api,
        eq: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        then: (res: any) => res({ data: rows }), // for `await query`
      };
      return api;
    },
  } as any;
}

describe('getChecklistState', () => {
  it('marks account always done and others based on data', async () => {
    const s = await getChecklistState(
      stub({
        diagnoses: [{ map: { workflows: [{}, {}] } }],
        connections: [{ status: 'active' }],
        nibbins: [{ kind: 'specialist', status: 'active' }],
        onboarding_handoff: [{ status: 'claimed' }],
      }),
      'acct-1',
    );
    expect(s.steps.find((x) => x.id === 'account')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'diagnosis')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'connection')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'adopt')?.done).toBe(true);
    expect(s.completed).toBe(s.total);
  });
  it('marks data-less steps not done', async () => {
    const s = await getChecklistState(stub({}), 'acct-1');
    expect(s.steps.find((x) => x.id === 'diagnosis')?.done).toBe(false);
    expect(s.completed).toBe(1); // only account
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** `cd apps/web && npx vitest run lib/help/checklist.test.ts` → FAIL.

- [ ] **Step 3: Implement `getChecklistState`** (adapt the exact query shapes to the real `lib/supabase` client API used elsewhere in `/app`; confirm against `app/app/page.tsx` and `app/app/diagnosis/page.tsx`).

```ts
// apps/web/lib/help/checklist.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChecklistStep { id: string; label: string; done: boolean; href: string; detail: string; auto: boolean; }
export interface ChecklistState { steps: ChecklistStep[]; completed: number; total: number; }

export async function getChecklistState(supabase: SupabaseClient, accountId: string): Promise<ChecklistState> {
  const eqAcct = (table: string, sel = '*') => supabase.from(table).select(sel).eq('account_id', accountId);

  const [diag, conns, nibs, handoff] = await Promise.all([
    eqAcct('diagnoses', 'map').limit(1),
    eqAcct('connections', 'status').eq('status', 'active').limit(1),
    eqAcct('nibbins', 'kind,status').eq('kind', 'specialist').eq('status', 'active').limit(1),
    eqAcct('onboarding_handoff', 'status').eq('status', 'claimed').limit(1),
  ]);

  const diagDone = !!(diag.data || []).find((d: any) => (d?.map?.workflows?.length ?? 0) > 0);
  const connDone = (conns.data || []).length > 0;
  const adoptDone = (nibs.data || []).length > 0;
  const installDone = diagDone || (handoff.data || []).length > 0;

  const steps: ChecklistStep[] = [
    { id: 'account', label: 'Create your account', done: true, href: '/app', detail: 'You’re in — welcome.', auto: true },
    { id: 'install', label: 'Install the desktop app & run a Field Study', done: installDone, href: '/app/diagnosis', detail: 'Download Nibbin and let it watch a little of your work.', auto: false },
    { id: 'diagnosis', label: 'Review your diagnosis', done: diagDone, href: '/app/diagnosis', detail: 'See the busywork Nibbin found.', auto: true },
    { id: 'connection', label: 'Connect a tool', done: connDone, href: '/app/connections', detail: 'Link Gmail (or request early access) so agents can help.', auto: true },
    { id: 'adopt', label: 'Adopt your first nibbin', done: adoptDone, href: '/app/shop', detail: 'Hatch an agent and approve its first drafts.', auto: true },
  ];
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length };
}
```

- [ ] **Step 4: Run the test — verify PASS.** Adjust the stub or query chain until green. `cd apps/web && npx vitest run lib/help/checklist.test.ts`.

- [ ] **Step 5: Implement `GettingStartedChecklist`** (client; takes `ChecklistState`; progress bar `completed/total`; each step a row with a check/empty marker, label, detail, and a link button to `href`; "auto-detected" steps show a subtle "auto" hint; manual `install` step shows a "Mark as done" affordance is NOT required — keep read-only based on inference).

```tsx
// apps/web/components/help/GettingStartedChecklist.tsx
'use client';
import Link from 'next/link';
import type { ChecklistState } from '../../lib/help/checklist';
import { Card, Button } from '../ui';
import styles from './help.module.css';

export function GettingStartedChecklist({ state }: { state: ChecklistState }) {
  const pct = Math.round((state.completed / state.total) * 100);
  return (
    <Card className={styles.checklist}>
      <div className={styles.checklistHead}>
        <h2>Getting started</h2>
        <span className={styles.progress}>{state.completed} of {state.total} done</span>
      </div>
      <div className={styles.bar}><span style={{ width: `${pct}%` }} /></div>
      <ul className={styles.steps}>
        {state.steps.map((s) => (
          <li key={s.id} className={s.done ? styles.stepDone : styles.step}>
            <span className={styles.mark} aria-hidden="true">{s.done ? '✓' : ''}</span>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>{s.label}</div>
              <p className={styles.stepDetail}>{s.detail}</p>
            </div>
            {!s.done && <Button as={Link} href={s.href} variant="secondary">Go</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

(If the UI kit `Button` does not support `as={Link}`, wrap a `<Link>` around a `<Button>` or use the kit's documented link pattern — check `components/ui`.)

- [ ] **Step 6: Add checklist styles** to `help.module.css` (progress `.bar` uses `var(--moss)` fill; `.stepDone` muted; tokens only).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/help/checklist.ts apps/web/components/help/GettingStartedChecklist.tsx apps/web/components/help/help.module.css apps/web/lib/help/checklist.test.ts
git commit -m "feat(help): live Getting-Started checklist (state + component)"
```

---

### Task 8: Help page + HelpHub + AppShell nav + HelpButton

**Files:**
- Create: `apps/web/app/app/help/page.tsx`
- Create: `apps/web/components/help/HelpHub.tsx`
- Create: `apps/web/components/shell/HelpButton.tsx`
- Modify: `apps/web/components/shell/AppShell.tsx`
- Modify: `apps/web/components/help/help.module.css`

**Interfaces:**
- `HelpHub({ content, connectors, checklist }: { content: HelpContent; connectors: ConnectorEntry[]; checklist: ChecklistState })` — client; holds search state; renders `GettingStartedChecklist`, `HelpSearch`, filtered sections via `HelpAccordion`, and `ConnectorDirectory` (inside/after the `connections` section).
- `page.tsx` (server): `appSession()` → `getChecklistState(supabase, accountId)` → render `<AppShell active="help" title="Help & Getting Started" email={user.email}><HelpHub .../></AppShell>`.

- [ ] **Step 1: Implement `HelpHub`** (client). Uses `filterHelp(query, content)`; when a query is active, render accordions with `open`; show "No results" when empty; render the `ConnectorDirectory` under the `connections` section (or as its own block) with `heading="All connectors"`.

```tsx
// apps/web/components/help/HelpHub.tsx
'use client';
import { useState } from 'react';
import type { HelpContent } from '../../lib/help/types';
import type { ConnectorEntry } from '../../lib/connections/catalog';
import type { ChecklistState } from '../../lib/help/checklist';
import { filterHelp } from '../../lib/help/content';
import { HelpSearch } from './HelpSearch';
import { HelpAccordion } from './HelpAccordion';
import { GettingStartedChecklist } from './GettingStartedChecklist';
import { ConnectorDirectory } from './ConnectorDirectory';
import styles from './help.module.css';

export function HelpHub({ content, connectors, checklist }: { content: HelpContent; connectors: ConnectorEntry[]; checklist: ChecklistState }) {
  const [query, setQuery] = useState('');
  const sections = filterHelp(query, content);
  return (
    <div className={styles.hub}>
      <GettingStartedChecklist state={checklist} />
      <HelpSearch value={query} onChange={setQuery} />
      {sections.length === 0 && <p className={styles.empty}>No results for “{query}”.</p>}
      {sections.map((s) => (
        <section key={s.id} id={s.id} className={styles.section}>
          <h2>{s.title}</h2>
          {s.intro && <p className={styles.intro}>{s.intro}</p>}
          {s.articles.map((a) => <HelpAccordion key={a.id} article={a} open={!!query} />)}
          {s.id === 'connections' && <ConnectorDirectory connectors={connectors} />}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement the server page**

```tsx
// apps/web/app/app/help/page.tsx
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { HelpHub } from '../../../components/help/HelpHub';
import { HELP_CONTENT } from '../../../lib/help/content';
import { CONNECTORS } from '../../../lib/connections/catalog';
import { getChecklistState } from '../../../lib/help/checklist';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const { supabase, user, accountId } = await appSession();
  const checklist = await getChecklistState(supabase, accountId);
  return (
    <AppShell active="help" title="Help & Getting Started" email={user.email ?? undefined}>
      <HelpHub content={HELP_CONTENT} connectors={CONNECTORS} checklist={checklist} />
    </AppShell>
  );
}
```

(Verify the exact `appSession` return shape + `AppShell` prop names against the real files before finalizing.)

- [ ] **Step 3: Add the `help` nav entry + icon to `AppShell.tsx`**

In `AppShell.tsx`: add `'help'` to the `NavKey` union; add `{ key: 'help', label: 'Help & Getting Started', href: '/app/help' }` to the `NAV` array (place it last, after `settings`); add a `help` case to `NavIcon()` (a question-mark-in-circle SVG, matching the existing icon style/stroke).

- [ ] **Step 4: Implement + mount `HelpButton`**

```tsx
// apps/web/components/shell/HelpButton.tsx
import Link from 'next/link';
import styles from './AppShell.module.css'; // reuse shell styles, or add a class

export function HelpButton() {
  return (
    <Link href="/app/help" aria-label="Help & Getting Started" title="Help" className={styles.helpButton}>
      ?
    </Link>
  );
}
```

Mount it in the topbar `.account` area immediately before `<NotificationBell />` in `AppShell.tsx`. Add a `.helpButton` style (circular, `var(--understory)` bg, `var(--ink-soft)`), or reuse an existing icon-button class.

- [ ] **Step 5: Add hub/section styles** to `help.module.css` (`.hub` max-width column, `.section`, `.intro`, `.empty`).

- [ ] **Step 6: Typecheck + build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors. Then (optional confidence, slower): `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/help/page.tsx apps/web/components/help/HelpHub.tsx apps/web/components/shell/HelpButton.tsx apps/web/components/shell/AppShell.tsx apps/web/components/help/help.module.css
git commit -m "feat(help): /app/help page, HelpHub, nav entry + topbar Help button"
```

---

### Task 9: Connections page — embed the directory roadmap

**Files:**
- Modify: `apps/web/app/app/connections/page.tsx` (confirm exact path; it's the existing Connections route)

**Interfaces:** Consumes `ConnectorDirectory` (client component) + `CONNECTORS`.

- [ ] **Step 1: Locate the connections page** (`grep -rl "connections" apps/web/app/app` / find the route rendering connect cards). Read it to match its layout + section conventions.

- [ ] **Step 2: Add a roadmap section** below the existing (live/connectable) connections: render `<ConnectorDirectory heading="Browse all connectors" />`. Keep the existing connect flow untouched; the directory is the comprehensive browse/roadmap view (status badges convey availability; non-testers see "Early access"/"Coming soon"). If the page is a server component, `ConnectorDirectory` (client) can be rendered directly as a child.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/app/connections/page.tsx
git commit -m "feat(connections): browse-all connector directory with real logos"
```

---

## Final verification (before PR)

- [ ] `cd apps/web && npx tsc --noEmit` clean.
- [ ] `cd apps/web && npx vitest run lib/connections lib/help components/help` all green.
- [ ] `npm run build` (apps/web) succeeds (catches RSC/client boundary issues).
- [ ] Manual: privacy claims read exactly per Global Constraints; no "<100ms"; model-improvement = opt-out/default-on; Telegram setup guide present; SMS/WhatsApp = coming soon.
- [ ] Logos: spot-check a few cards render real Clearbit logos; null-domain rails + any 404 show the monogram.

## Adversarial gate + PR

This PR touches privacy-claim copy + connection surfaces → **run the 4-reviewer adversarial gate** (red-team / claims-auditor / logic-skeptic / cost-auditor) per `feedback_nibbin_adversarial_gate_always`. Rebase on latest `main` first; write the report to `docs/gates/2026-06-19-help-getting-started.md`; fix all P1s. Then open the PR to `main` and set `gh pr merge <n> --auto --squash`. The claims-auditor specifically checks: model-training two-part statement, pause "near-instantly", secure-fields "by construction", connector status truth (only Gmail live).

---

## Self-Review notes

- **Spec coverage:** getting-started/checklist (T7,T8), all features+tips+constraints+FAQ (T4,T5), Telegram setup + SMS/WhatsApp coming-soon (T4/T5 channels), 150+ connector directory in help + connections with real logos (T1,T2,T3,T8,T9), live-state checklist (T7), privacy accuracy (Global Constraints + T5 grep gate). Covered.
- **Type consistency:** `ConnectorEntry`/`ConnectorStatus`/`CONNECTORS`/`CONNECTOR_CATEGORIES` (T1) used by T2/T3/T8/T9; `HelpContent`/`HelpSection`/`HelpArticle`/`filterHelp` (T4) used by T5/T6/T8; `ChecklistState`/`getChecklistState` (T7) used by T8. Consistent.
- **Open confirmations for implementers (not blockers):** exact `appSession()` return + `AppShell` props; UI-kit `Button`-as-link pattern; `Badge` `sky` tone; CSP location; connections route path; `@testing-library/react` availability (fall back to helper-only tests if absent).
