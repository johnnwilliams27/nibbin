'use client';

/**
 * ReachMeModal — "Reach me on the go".
 *
 * A generic channels modal surfaced from inside the Keeper chat (panel header
 * and focal header). It reuses the EXACT server actions and copy from the
 * Data & Privacy page (connectChannel / disconnectChannel / saveChannelPrefs)
 * and the channelMeta() helper — no new backend, no new RPC.
 *
 * Three per-channel states:
 *   1. Not connected — Telegram "Connect Telegram" button (a <form> POSTing the
 *      channel) + SMS/WhatsApp rendered disabled with a "Coming soon" badge.
 *   2. Connecting/handoff — copy guiding the user to tap START in the bot, with
 *      an "Open Telegram again" affordance (re-runs connectChannel).
 *   3. Connected — a status badge, a "Reach me here" on/off toggle (saveChannelPrefs
 *      with priority/urgency carried as hidden inputs so they aren't clobbered),
 *      Disconnect, and a link to /app/settings/privacy for granular controls.
 *
 * Focus-poll auto-refresh: when the window regains focus (or the modal opens),
 * we router.refresh() to re-query connection status so the connected state
 * appears after the Telegram handoff. Simple focus listener — not a tight poll.
 *
 * Accessibility mirrors SynthesisModal: role="dialog", aria-modal, Escape to
 * close, close button focused on open, backdrop click closes.
 *
 * Known accepted edge: connectChannel redirects to /app/settings/privacy on its
 * error / non-Telegram-live branches. Fine for the Telegram-live happy path.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Badge } from '../../../components/ui';
import {
  connectChannel,
  disconnectChannel,
  saveChannelPrefs,
} from '../settings/privacy/actions';
import type { ReachMeChannel } from '../../../lib/privacy/reach-me';
import styles from './reach-me.module.css';

export const REACH_ME_TITLE = 'Reach me on the go.';

export interface ReachMeModalProps {
  channels: ReachMeChannel[];
  botHandle: string | null;
  onClose: () => void;
}

export function ReachMeModal({ channels, botHandle, onClose }: ReachMeModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  // Focus the close button on open.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape closes.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus-poll auto-refresh: re-query connection status when the window regains
  // focus (e.g. coming back from the Telegram handoff) and once on open. Keeps
  // it simple — a focus listener, not a tight interval. router.refresh() re-runs
  // the server component tree (layout/page) which re-reads notification_channels.
  useEffect(() => {
    router.refresh();
    function onFocus() {
      router.refresh();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [router]);

  const content = (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={REACH_ME_TITLE}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.heading}>{REACH_ME_TITLE}</h2>
            <p className={styles.subhead}>
              Pick a channel and your grove can reach you outside the app — with one-tap
              approvals. Nothing sensitive happens here; the app always has your back.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className={styles.channelList}>
          {channels.map((c) => (
            <ChannelRow key={c.channel} channel={c} botHandle={botHandle} />
          ))}
        </div>

        <Link className={styles.footerLink} href="/app/settings/privacy">
          Quiet hours &amp; urgency settings →
        </Link>
        <p className={styles.footnote}>
          Manage granular controls — quiet hours, urgency thresholds, and digests — in Data
          &amp; Privacy.
        </p>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return content;
  }
  return createPortal(content, document.body);
}

function ChannelRow({
  channel: c,
  botHandle,
}: {
  channel: ReachMeChannel;
  botHandle: string | null;
}) {
  const connected = c.status === 'verified';
  const pending = c.status === 'pending';

  return (
    <div className={styles.channelRow}>
      <div className={styles.channelHead}>
        <p className={styles.channelLabel}>{c.label}</p>
        {connected && <Badge tone="moss">Connected</Badge>}
        {pending && <Badge tone="honey">Connecting…</Badge>}
        {!c.live && <Badge tone="neutral">Coming soon</Badge>}
      </div>

      {connected ? (
        <div className={styles.connectedControls}>
          {/* "Reach me here" on/off — carries existing priority + urgency as
              hidden inputs so saving the toggle doesn't clobber the values set
              on the granular privacy page. saveChannelPrefs reads enabled === 'on'. */}
          <form action={saveChannelPrefs} className={styles.toggleRow}>
            <input type="hidden" name="channel" value={c.channel} />
            <input type="hidden" name="priority" value={String(c.priority)} />
            <input type="hidden" name="urgency_threshold" value={c.urgencyThreshold} />
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={c.enabled}
                // Submit on change so the toggle reads as an instant switch.
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              />
              Reach me here
            </label>
          </form>
          <div className={styles.rowActions}>
            <form action={disconnectChannel}>
              <input type="hidden" name="channel_id" value={c.channelId ?? ''} />
              <Button type="submit" variant="ghost">
                Disconnect
              </Button>
            </form>
          </div>
        </div>
      ) : pending ? (
        <div className={styles.connectedControls}>
          <p className={styles.handoff}>
            Opening Telegram… tap START in{' '}
            <span className={styles.handoffBot}>@{botHandle ?? 'the bot'}</span>, then come
            back — you&apos;ll see it connect here.
          </p>
          <div className={styles.rowActions}>
            <form action={connectChannel}>
              <input type="hidden" name="channel" value={c.channel} />
              <Button type="submit" variant="secondary">
                Open Telegram again
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.channelHelp}>{c.help}</p>
          <form action={connectChannel}>
            <input type="hidden" name="channel" value={c.channel} />
            <Button type="submit" variant="primary" disabled={!c.live}>
              {c.live ? `Connect ${c.label}` : 'Coming soon'}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
