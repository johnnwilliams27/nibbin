/**
 * Task 5 — NotificationBell initialUnread prop tests.
 *
 * Plan §5h: "Render <NotificationBell initialUnread={5} />. Assert badge shows 5
 * without waiting for any effect."
 *
 * NotificationBell is a 'use client' component that uses hooks (useState, useEffect,
 * useRef, useCallback). renderToStaticMarkup does NOT execute hooks (no effect queue
 * in static rendering), so useState's initial value is used as-is — which is exactly
 * what we need to confirm: initialUnread seeds the badge immediately.
 *
 * @testing-library/react is NOT installed in this repo; using renderToStaticMarkup
 * per the project's no-jsdom pattern.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationBell } from './NotificationBell';

// Stub next/navigation — renderToStaticMarkup never runs hooks but the module
// import still resolves; we need a no-op stub to avoid "useRouter is not a function".
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Stub the server action import — not called during static rendering but import
// must resolve without hitting the Next.js server-only guard in vitest.
vi.mock('../../app/app/notifications/actions', () => ({
  listLeaves: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
  markRead: vi.fn().mockResolvedValue(undefined),
  markAllRead: vi.fn().mockResolvedValue(undefined),
}));

// Stub @nibbin/creatures — buildCreature is not needed for static badge tests.
vi.mock('@nibbin/creatures', () => ({
  buildCreature: vi.fn(() => '<svg></svg>'),
}));

// CSS module stub (vitest doesn't load CSS; classes are strings like 'badge').
vi.mock('./notification-center.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell — initialUnread prop (§10.3)', () => {
  it('5h: renders badge with initialUnread=5 immediately (no async fetch required)', () => {
    const html = renderToStaticMarkup(<NotificationBell initialUnread={5} />);
    // The badge span must be present with the count
    expect(html).toContain('5');
    // The bell button aria-label must announce the unread count
    expect(html).toContain('5 unread');
  });

  it('shows no badge when initialUnread=0', () => {
    const html = renderToStaticMarkup(<NotificationBell initialUnread={0} />);
    // aria-label should be 'Leaves' (no count)
    expect(html).toContain('aria-label="Leaves"');
    // No badge span (unread=0 branch renders nothing)
    expect(html).not.toContain('unread');
  });

  it('caps badge at 9+ when initialUnread=12', () => {
    const html = renderToStaticMarkup(<NotificationBell initialUnread={12} />);
    expect(html).toContain('9+');
  });

  it('default initialUnread is 0 (backward compat — existing callers without prop)', () => {
    // Calling with no prop must not throw and must show no badge
    const html = renderToStaticMarkup(<NotificationBell />);
    expect(html).toContain('aria-label="Leaves"');
  });
});
