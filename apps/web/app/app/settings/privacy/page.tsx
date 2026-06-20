import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge, InlineFeedback, Select } from '../../../../components/ui';
import { setContribution, setNotificationPrefs, setSweepConsent, connectChannel, disconnectChannel, saveChannelPrefs, saveNotificationSettings } from './actions';
import { HOUR_OPTIONS } from '../../../../lib/privacy/notifications';
import { channelMeta, URGENCY_OPTIONS, DIGEST_OPTIONS } from '../../../../lib/privacy/channels';
import { connectionSummary, deletionState, sweepConsentRow, type ConnectionRow } from '../../../../lib/privacy/panel';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Data & Privacy — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PrivacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; error?: string }>;
}) {
  const { state, error } = await searchParams;

  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  const { data: acct } = await supabase
    .from('accounts')
    .select('purge_after, model_contribution_enabled')
    .eq('id', accountId)
    .single<{ purge_after: string | null; model_contribution_enabled: boolean }>();
  const del = deletionState(acct?.purge_after);
  const contributing = acct?.model_contribution_enabled ?? true;

  const { data: conns } = await supabase
    .from('connections')
    .select('provider, scopes, status, sweep_consent_at')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const summary = connectionSummary((conns ?? []) as ConnectionRow[]);
  const sweep = sweepConsentRow((conns ?? []) as ConnectionRow[]);

  const { data: drip } = await supabase
    .from('drip_arcs')
    .select('email_enabled')
    .eq('account_id', accountId)
    .maybeSingle<{ email_enabled: boolean }>();
  const emailEnabled = drip?.email_enabled ?? true;

  const { data: channels } = await supabase
    .from('notification_channels')
    .select('id, channel, status, external_label')
    .neq('status', 'revoked');
  const { data: chanPrefs } = await supabase
    .from('channel_prefs')
    .select('channel, enabled, priority, urgency_threshold');
  const { data: settings } = await supabase
    .from('notification_settings')
    .select('quiet_start, quiet_end, digest_mode')
    .maybeSingle();

  const flags = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    sms: process.env.CHANNELS_SMS_ENABLED === 'true',
    whatsapp: process.env.CHANNELS_WHATSAPP_ENABLED === 'true',
  };
  const meta = channelMeta(flags);
  const prefByChannel = new Map((chanPrefs ?? []).map((p) => [p.channel, p]));
  const connectedByChannel = new Map((channels ?? []).map((c) => [c.channel, c]));
  const settingsQuietStart = settings?.quiet_start ?? 21;
  const settingsQuietEnd = settings?.quiet_end ?? 9;
  const digestMode = settings?.digest_mode ?? 'smart';

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="privacy" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>What the Field Study sees</h2>
          <p className={styles.sectionHint}>
            The two-week Field Study runs on your device. Banking, health, and other sensitive
            categories are excluded by default, secure fields like passwords can&apos;t be captured,
            and you can exclude any app or site or pause everything with one hotkey.
          </p>
          <p className={styles.dangerNote}>
            Only the redacted synthesis packet ever leaves your device, and only when you choose to
            build your diagnosis. Your screen recordings never do — by architecture, not policy.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>How long things are kept</h2>
          <ul className={styles.connList}>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Raw Field Study data</span>
                <span className={styles.connScopes}>On your device, until your diagnosis is built — 14 days max.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Agent run logs</span>
                <span className={styles.connScopes}>90 days by default; shorten or wipe them anytime.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Connection tokens</span>
                <span className={styles.connScopes}>Held in an encrypted vault while connected; one-click revoke.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Account data</span>
                <span className={styles.connScopes}>Life of the account, plus 30 days after verified deletion.</span>
              </div>
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Connections</h2>
          <p className={styles.sectionHint}>
            {summary.total === 0
              ? 'No tools are connected yet. Connections start read-only — a Nibbin asks for write access separately, in plain words.'
              : `You have ${summary.total} connected ${summary.total === 1 ? 'tool' : 'tools'}. Connections start read-only; write access is granted per Nibbin, by you.`}
          </p>
          {summary.total > 0 && (
            <ul className={styles.connList}>
              {summary.items.map((c) => (
                <li key={c.provider} className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>{c.provider}</span>
                    <span className={styles.connScopes}>{c.access}</span>
                  </div>
                  <Badge tone={c.status === 'active' ? 'moss' : 'neutral'}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <Link href="/app/connections">
              <Button variant="secondary">Manage connections</Button>
            </Link>
          </div>
        </Card>

        {sweep.gmailConnected && (
          <Card>
            <h2 className={styles.sectionTitle}>Learn from my Gmail history</h2>
            <p className={styles.sectionHint}>
              A one-time read of about your last 12 months of sent &amp; inbox mail to learn your
              voice and common questions. Your sent messages are processed by the model; your inbox is
              reduced to subjects and previews. Only short derived notes are kept.
            </p>
            {state === 'sweep_saved' && <InlineFeedback tone="success">Saved.</InlineFeedback>}
            {error === 'sweep' && <InlineFeedback tone="error">Couldn&apos;t update that — try again.</InlineFeedback>}
            <div className={styles.actions}>
              <Badge tone={sweep.consented ? 'moss' : 'neutral'}>{sweep.consented ? 'On' : 'Off'}</Badge>
              <form action={setSweepConsent}>
                <input type="hidden" name="enabled" value={sweep.consented ? 'false' : 'true'} />
                <Button type="submit" variant="secondary">{sweep.consented ? 'Turn off' : 'Turn on'}</Button>
              </form>
            </div>
          </Card>
        )}

        <Card>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <p className={styles.sectionHint}>
            During your field study, your grove sends a few gentle email nudges — Field Notes,
            milestones, your map when it&apos;s ready. Turn them off here. Quiet hours are now set
            in the card below.
          </p>
          {state === 'notify_saved' && (
            <InlineFeedback tone="success">Saved — your notification choices are recorded.</InlineFeedback>
          )}
          {error === 'notify' && (
            <InlineFeedback tone="error">That didn&apos;t save — give it another go.</InlineFeedback>
          )}
          <form action={setNotificationPrefs} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email_enabled">
                Companion emails
              </label>
              <label className={styles.fieldHint}>
                <input
                  id="email_enabled"
                  name="email_enabled"
                  type="checkbox"
                  defaultChecked={emailEnabled}
                />{' '}
                Email me the field-study nudges
              </label>
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Save notifications
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Where your grove reaches you</h2>
          <p className={styles.sectionHint}>
            Choose the channels your grove can reach you on, and how it tries them. The app always has
            your back — it&apos;s the one place anything sensitive happens.
          </p>
          {state === 'channel_saved' && <InlineFeedback tone="success">Saved — your channel choices are recorded.</InlineFeedback>}
          {state === 'channel_removed' && <InlineFeedback tone="success">Disconnected.</InlineFeedback>}
          {error === 'channel' && <InlineFeedback tone="error">That didn&apos;t go through — give it another go.</InlineFeedback>}

          {(['telegram', 'sms', 'whatsapp'] as const).map((ch) => {
            const m = meta[ch];
            const connected = connectedByChannel.get(ch);
            const pref = prefByChannel.get(ch);
            return (
              <div key={ch} className={styles.field}>
                <label className={styles.label}>
                  {m.label}{' '}
                  {connected?.status === 'verified' && <Badge tone="moss">Connected</Badge>}
                  {connected?.status === 'pending' && <Badge tone="honey">Pending</Badge>}
                  {!m.live && <Badge tone="neutral">Coming soon</Badge>}
                </label>
                <span className={styles.fieldHint}>{m.help}</span>

                {connected?.status === 'verified' ? (
                  <>
                    <form action={saveChannelPrefs} className={styles.form}>
                      <input type="hidden" name="channel" value={ch} />
                      <label className={styles.fieldHint}>
                        <input type="checkbox" name="enabled" defaultChecked={pref?.enabled ?? true} /> Reach me here
                      </label>
                      <Select name="urgency_threshold" defaultValue={pref?.urgency_threshold ?? 'all'} options={URGENCY_OPTIONS} aria-label={`${m.label} urgency`} />
                      <input type="hidden" name="priority" value={String(pref?.priority ?? 100)} />
                      <div className={styles.actions}><Button type="submit" variant="secondary">Save</Button></div>
                    </form>
                    <form action={disconnectChannel}>
                      <input type="hidden" name="channel_id" value={connected.id} />
                      <Button type="submit" variant="ghost">Disconnect</Button>
                    </form>
                  </>
                ) : (
                  <form action={connectChannel}>
                    <input type="hidden" name="channel" value={ch} />
                    <Button type="submit" variant="primary" disabled={!m.live}>
                      {m.live ? `Connect ${m.label}` : 'Coming soon'}
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Quiet hours & digests</h2>
          <p className={styles.sectionHint}>
            Pick when your grove stays quiet, and how it batches the non-urgent. Only genuinely urgent
            things cross your quiet hours.
          </p>
          {state === 'quiet_saved' && <InlineFeedback tone="success">Saved.</InlineFeedback>}
          {error === 'quiet' && <InlineFeedback tone="error">That didn&apos;t save — give it another go.</InlineFeedback>}
          <form action={saveNotificationSettings} className={styles.form}>
            <input type="hidden" name="email_enabled" value={emailEnabled ? 'on' : ''} />
            <div className={styles.field}>
              <label className={styles.label} htmlFor="qs">Quiet hours start</label>
              <Select id="qs" name="quiet_start" defaultValue={String(settingsQuietStart)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="qe">Quiet hours end</label>
              <Select id="qe" name="quiet_end" defaultValue={String(settingsQuietEnd)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dm">Non-urgent notifications</label>
              <Select id="dm" name="digest_mode" defaultValue={digestMode} options={DIGEST_OPTIONS} />
            </div>
            <div className={styles.actions}><Button type="submit" variant="primary">Save quiet hours</Button></div>
          </form>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Model improvement</h2>
          <p className={styles.sectionHint}>
            Nibbin never trains on your content. When this is on, Nibbin learns from anonymized,
            aggregate signals about how its capabilities and models perform — never your data,
            never your content, and never sold. You can turn it off anytime.
          </p>
          {state === 'saved' && (
            <InlineFeedback tone="success">Saved — your choice is recorded.</InlineFeedback>
          )}
          {error === 'contribution' && (
            <InlineFeedback tone="error">That didn&apos;t save — give it another go.</InlineFeedback>
          )}
          <div className={styles.actions}>
            <Badge tone={contributing ? 'moss' : 'neutral'}>{contributing ? 'On' : 'Off'}</Badge>
            <form action={setContribution}>
              <input type="hidden" name="enabled" value={contributing ? 'false' : 'true'} />
              <Button type="submit" variant="secondary">
                {contributing ? 'Turn off' : 'Turn on'}
              </Button>
            </form>
          </div>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Your data</h2>
          {del.pending && del.date ? (
            <>
              <Badge tone="coral">Scheduled for deletion</Badge>
              <p className={styles.dangerNote} style={{ marginTop: 10 }}>
                Your account is scheduled to be permanently deleted on {formatDate(del.date)}. Every
                connection has already been disconnected. You can stop this from the Account tab.
              </p>
            </>
          ) : (
            <p className={styles.sectionHint}>
              You can delete your account and everything in it — your grove, your Nibbins, your
              diagnosis, and every connection — from the Account tab. On the desktop app, &quot;Delete
              everything&quot; wipes the captured study data on this machine and verifies it&apos;s gone.
            </p>
          )}
          <div className={styles.actions}>
            <Link href="/app/settings/account">
              <Button variant="secondary">Go to Account</Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
