import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { loadStyleProfile } from '../../../../lib/style/load';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge, InlineFeedback } from '../../../../components/ui';
import { saveStyleNotes, resetStyleProfile } from './actions';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'My Voice — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

function formalityLabel(v: number | null): string {
  if (v === null) return '—';
  if (v < 0.25) return 'Casual';
  if (v < 0.5) return 'Somewhat casual';
  if (v < 0.75) return 'Somewhat formal';
  return 'Formal';
}

function sentimentLabel(v: number | null): string {
  if (v === null) return '—';
  if (v < -0.4) return 'Direct and concise';
  if (v < 0.2) return 'Neutral';
  return 'Warm and approachable';
}

function paceLabel(v: number | null): string {
  if (v === null) return '—';
  if (v < 0.35) return 'Brief and terse';
  if (v < 0.65) return 'Moderate length';
  return 'Detailed and thorough';
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default async function StyleSettingsPage({
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
  const { user, accountId } = session;

  const profile = await loadStyleProfile(accountId);
  const tone = profile?.tone_profile ?? null;
  const stats = profile?.stats;
  const editsAnalyzed = stats?.edits_analyzed ?? 0;
  const confidence = stats?.confidence ?? 0;
  const hasProfile = profile !== null && editsAnalyzed > 0;

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="style" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>My Voice</h2>
          <p className={styles.sectionHint}>
            Your style profile is per-account, never shared, and used only to make drafts sound like
            you. It is derived from the corrections you make to drafts — no raw text is ever stored.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>What your Nibbins have learned</h2>
          {!hasProfile && (
            <p className={styles.sectionHint}>
              No style data yet. Edit a few drafts and your voice profile will appear here.
            </p>
          )}
          {hasProfile && (
            <>
              <p className={styles.sectionHint}>
                Confidence: {pct(confidence)} — learned from {editsAnalyzed}{' '}
                {editsAnalyzed === 1 ? 'edit' : 'edits'}.
              </p>
              <ul className={styles.connList}>
                <li className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>Tone</span>
                    <span className={styles.connScopes}>{formalityLabel(tone?.formality ?? null)}</span>
                  </div>
                </li>
                <li className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>Register</span>
                    <span className={styles.connScopes}>{sentimentLabel(tone?.sentiment ?? null)}</span>
                  </div>
                </li>
                <li className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>Length</span>
                    <span className={styles.connScopes}>{paceLabel(tone?.pace ?? null)}</span>
                  </div>
                </li>
                {(tone?.signature_sign_offs ?? []).length > 0 && (
                  <li className={styles.connItem}>
                    <div className={styles.connMain}>
                      <span className={styles.connProvider}>Sign-offs</span>
                      <span className={styles.connScopes}>
                        {(tone?.signature_sign_offs ?? []).join('  ·  ')}
                      </span>
                    </div>
                  </li>
                )}
                {(tone?.removals ?? []).length > 0 && (
                  <li className={styles.connItem}>
                    <div className={styles.connMain}>
                      <span className={styles.connProvider}>Things to avoid</span>
                      <span className={styles.connScopes}>
                        {(tone?.removals ?? []).join(', ')}
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            </>
          )}
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Your note</h2>
          <p className={styles.sectionHint}>
            Add anything about your writing voice that your Nibbins should always know. Max 1000 characters.
          </p>
          {state === 'saved' && <InlineFeedback tone="success">Saved.</InlineFeedback>}
          {error === 'notes' && <InlineFeedback tone="error">Couldn&apos;t save — try again.</InlineFeedback>}
          <form action={saveStyleNotes} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="user_notes">
                Voice note
              </label>
              <textarea
                id="user_notes"
                name="user_notes"
                className={styles.input}
                rows={4}
                maxLength={1000}
                defaultValue={profile?.user_notes ?? ''}
                placeholder="e.g. I prefer short paragraphs. Never use exclamation marks. Sign off with Thanks,"
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary">Save note</Button>
            </div>
          </form>
        </Card>

        {hasProfile && (
          <Card>
            <h2 className={styles.sectionTitle}>Reset style</h2>
            <p className={styles.sectionHint}>
              Clears everything Nibbin has learned about your voice. Your note above is also cleared.
              The profile rebuilds from scratch as you keep editing drafts.
            </p>
            {state === 'reset' && <InlineFeedback tone="success">Style profile cleared.</InlineFeedback>}
            {error === 'reset' && <InlineFeedback tone="error">Couldn&apos;t reset — try again.</InlineFeedback>}
            <div className={styles.actions}>
              <Badge tone="neutral">Irreversible</Badge>
              <form action={resetStyleProfile}>
                <Button type="submit" variant="ghost">Reset my voice profile</Button>
              </form>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
