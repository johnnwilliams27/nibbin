/**
 * AppShell nav — Agent Builder merge.
 *
 * Verifies the nav now exposes ONE "Agent Builder" entry (/app/build) in place
 * of the two old "Hatch your own" (/app/hatch) and "Planner" (/app/planner)
 * items — the jargon-collision merge.
 *
 * renderToStaticMarkup per the repo's no-jsdom pattern (effects don't run, so
 * the SSR-default expanded nav renders every <Link> with its label + href).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { AppShell } from './AppShell';

// next/navigation: no hooks run under static render, but the import must resolve.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Server-action import used by the shell's mount effect (never fires statically).
vi.mock('../../app/app/notifications/actions', () => ({
  listLeaves: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
}));

vi.mock('@nibbin/creatures', () => ({
  buildCreature: vi.fn(() => '<svg></svg>'),
}));

// CSS module stub — class names come back as their key strings.
vi.mock('./shell.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

describe('AppShell nav — Agent Builder merge', () => {
  const html = renderToStaticMarkup(
    <AppShell active="build" title="Agent Builder" email="x@y.com">
      <div>child</div>
    </AppShell>,
  );

  it('renders one "Agent Builder" entry pointing at /app/build', () => {
    expect(html).toContain('Agent Builder');
    expect(html).toContain('href="/app/build"');
  });

  it('drops the old "Hatch your own" and "Planner" nav items', () => {
    expect(html).not.toContain('Hatch your own');
    expect(html).not.toContain('>Planner<');
    expect(html).not.toContain('href="/app/hatch"');
    expect(html).not.toContain('href="/app/planner"');
  });

  it('marks the Agent Builder link active (aria-current) when active="build"', () => {
    expect(html).toContain('aria-current="page"');
  });

  it('keeps the rest of the nav intact (Connections, Diagnosis, Memory still present)', () => {
    expect(html).toContain('href="/app/connections"');
    expect(html).toContain('href="/app/diagnosis"');
    expect(html).toContain('href="/app/memory"');
  });
});
