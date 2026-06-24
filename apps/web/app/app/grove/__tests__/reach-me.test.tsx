/**
 * Reach me on the go — component + loader tests.
 *
 * Strategy mirrors synthesis-ui.test.tsx: no jsdom; render with
 * renderToStaticMarkup from react-dom/server and assert on markup.
 * next/navigation (useRouter) and the privacy server actions are mocked so the
 * client modal renders inline on the server without a router provider.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// useRouter must return a router-like object with refresh() — the modal calls
// it in an effect (no-op under SSR) but the hook itself must resolve.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The modal imports the privacy server actions for <form action={...}>. Under
// the server-rendering test they only need to be referenceable, not callable.
vi.mock('../../settings/privacy/actions', () => ({
  connectChannel: vi.fn(),
  disconnectChannel: vi.fn(),
  saveChannelPrefs: vi.fn(),
}));

import { ReachMeModal, REACH_ME_TITLE } from '../ReachMeModal';
import { ReachMeButton } from '../ReachMeButton';
import type { ReachMeChannel } from '../../../../lib/privacy/reach-me';

function channel(over: Partial<ReachMeChannel>): ReachMeChannel {
  return {
    channel: 'telegram',
    label: 'Telegram',
    help: 'Connect Telegram for instant, free reach with one-tap approvals.',
    live: true,
    channelId: null,
    status: null,
    enabled: true,
    priority: 100,
    urgencyThreshold: 'all',
    ...over,
  };
}

const NOT_CONNECTED: ReachMeChannel[] = [
  channel({ channel: 'telegram', label: 'Telegram', live: true }),
  channel({ channel: 'sms', label: 'Text (SMS)', live: false, help: 'soon' }),
  channel({ channel: 'whatsapp', label: 'WhatsApp', live: false, help: 'soon' }),
];

describe('ReachMeModal', () => {
  it('uses the approved title — and never "remote access"', () => {
    const html = renderToStaticMarkup(
      <ReachMeModal channels={NOT_CONNECTED} botHandle="NibbinGroveBot" onClose={() => {}} />,
    );
    expect(html).toContain('Reach me on the go');
    expect(REACH_ME_TITLE).toBe('Reach me on the go.');
    expect(html.toLowerCase()).not.toContain('remote access');
  });

  it('is a dialog with the approved aria-label', () => {
    const html = renderToStaticMarkup(
      <ReachMeModal channels={NOT_CONNECTED} botHandle="b" onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Reach me on the go."');
  });

  it('not-connected: shows "Connect Telegram" and SMS/WhatsApp disabled + Coming soon', () => {
    const html = renderToStaticMarkup(
      <ReachMeModal channels={NOT_CONNECTED} botHandle="b" onClose={() => {}} />,
    );
    expect(html).toContain('Connect Telegram');
    // SMS + WhatsApp render disabled buttons labelled "Coming soon".
    expect(html).toContain('Coming soon');
    expect(html).toContain('disabled');
  });

  it('connecting/handoff: shows the START-in-bot copy and "Open Telegram again"', () => {
    const pending: ReachMeChannel[] = [
      channel({ status: 'pending', channelId: 'nc-1' }),
      ...NOT_CONNECTED.slice(1),
    ];
    const html = renderToStaticMarkup(
      <ReachMeModal channels={pending} botHandle="NibbinGroveBot" onClose={() => {}} />,
    );
    expect(html).toContain('Opening Telegram');
    expect(html).toContain('tap START');
    expect(html).toContain('@NibbinGroveBot');
    expect(html).toContain('Open Telegram again');
  });

  it('connected: shows status badge, "Reach me here" toggle, and Disconnect', () => {
    const connected: ReachMeChannel[] = [
      channel({ status: 'verified', channelId: 'nc-1', enabled: true }),
      ...NOT_CONNECTED.slice(1),
    ];
    const html = renderToStaticMarkup(
      <ReachMeModal channels={connected} botHandle="b" onClose={() => {}} />,
    );
    expect(html).toContain('Connected');
    expect(html).toContain('Reach me here');
    expect(html).toContain('Disconnect');
  });

  it('connected: carries priority + urgency as hidden inputs so saving the toggle does not clobber them', () => {
    const connected: ReachMeChannel[] = [
      channel({ status: 'verified', channelId: 'nc-1', priority: 250, urgencyThreshold: 'high' }),
    ];
    const html = renderToStaticMarkup(
      <ReachMeModal channels={connected} botHandle="b" onClose={() => {}} />,
    );
    expect(html).toContain('name="priority" value="250"');
    expect(html).toContain('name="urgency_threshold" value="high"');
  });

  it('links to /app/settings/privacy for granular controls', () => {
    const html = renderToStaticMarkup(
      <ReachMeModal channels={NOT_CONNECTED} botHandle="b" onClose={() => {}} />,
    );
    expect(html).toContain('/app/settings/privacy');
  });
});

describe('ReachMeButton', () => {
  it('renders a paper-plane trigger with the approved aria-label/title and no open modal', () => {
    const html = renderToStaticMarkup(
      <ReachMeButton reachMe={{ botHandle: 'b', channels: NOT_CONNECTED }} />,
    );
    expect(html).toContain('aria-label="Reach me on the go."');
    expect(html).toContain('title="Reach me on the go."');
    expect(html).toContain('<svg');
    // Modal is closed by default — dialog markup absent.
    expect(html).not.toContain('role="dialog"');
  });
});
