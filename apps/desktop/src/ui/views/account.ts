/**
 * Shared account-management module — desktop shell (§6.1: "same API, two
 * shells"). Sign-in runs through the SYSTEM browser with the nibbin://auth
 * deep link; tokens live in the OS keychain (the Rust side owns them — this
 * view only ever sees a session snapshot). Data reads go through the same
 * Supabase RLS surface the web app uses.
 */
import { bridge } from '../bridge.js';
import { button, clear, el } from '../dom.js';

const SUPABASE_URL = (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) ?? '';
const SUPABASE_KEY = (import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined) ?? '';

interface AccountSummary {
  accountName: string;
  email: string;
  tier: string;
  balance: number | null;
}

async function fetchAccount(accessToken: string): Promise<AccountSummary | null> {
  if (!SUPABASE_URL) return null;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${accessToken}`,
  };
  // the same RLS-scoped surface the web dashboard reads (M1)
  const [accountsRes, balancesRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/accounts?select=id,name`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/credit_balances?select=account_id,balance`, { headers }),
  ]);
  if (!accountsRes.ok) return null;
  const accounts = (await accountsRes.json()) as { id: string; name: string }[];
  const balances = balancesRes.ok ? ((await balancesRes.json()) as { account_id: string; balance: number }[]) : [];
  const account = accounts[0];
  if (!account) return null;
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?select=tier,status&account_id=eq.${account.id}`,
    { headers },
  );
  const subs = subsRes.ok ? ((await subsRes.json()) as { tier: string; status: string }[]) : [];
  return {
    accountName: account.name,
    email: '',
    tier: subs[0]?.tier ?? 'hatchling',
    balance: balances.find((b) => b.account_id === account.id)?.balance ?? null,
  };
}

function signInView(refresh: () => void): HTMLElement {
  const root = el('div', {}, [
    el('p', { class: 'eyebrow' }, ['Account']),
    el('h1', {}, ['Sign in to your grove']),
    el('p', { class: 'muted' }, [
      'Signing in opens your regular browser — the Observer never asks for your password itself. Your field study stays on this machine either way; the account link just lets your diagnosis find its way to your grove.',
    ]),
  ]);
  const email = el('input', { type: 'email', placeholder: 'you@example.com' });
  const note = el('p', { class: 'muted' }, ['']);
  root.append(
    el('div', { class: 'card stack' }, [
      el('div', { class: 'row' }, [
        button('Continue with Google', () => void bridge.authStart('google').then(refresh), 'primary'),
        button('Continue with Apple', () => void bridge.authStart('apple').then(refresh)),
      ]),
      el('div', { class: 'row' }, [
        email,
        button('Email me a sign-in link', () => {
          const value = email.value.trim();
          if (!value) return;
          void bridge.authStart('magic', value).then(() => {
            note.textContent = 'Check your inbox — the link opens right back here.';
          });
        }),
      ]),
      note,
    ]),
  );
  return root;
}

export function accountView(): HTMLElement {
  const root = el('div', {}, [el('p', { class: 'muted' }, ['Loading account…'])]);

  async function refresh(): Promise<void> {
    const session = await bridge.authSession();
    clear(root);
    if (session === null) {
      root.append(signInView(() => void refresh()));
      return;
    }

    const accessToken = (session['access_token'] as string | undefined) ?? '';
    const userEmail = ((session['user'] as Record<string, unknown> | undefined)?.['email'] as string) ?? '';
    const summary = accessToken ? await fetchAccount(accessToken) : null;

    root.append(
      el('p', { class: 'eyebrow' }, ['Account']),
      el('h1', {}, [summary?.accountName ?? 'Your grove']),
      el('div', { class: 'card' }, [
        el('h2', {}, ['Profile']),
        el('p', {}, [userEmail || 'Signed in']),
        button('Sign out on this device', () => void bridge.signOut().then(() => void refresh())),
      ]),
      el('div', { class: 'card' }, [
        el('h2', {}, ['Plan & meter']),
        el('div', { class: 'stat-grid' }, [
          el('div', { class: 'stat' }, [
            el('div', { class: 'value' }, [summary?.tier ?? '—']),
            el('div', { class: 'label' }, ['Plan']),
          ]),
          el('div', { class: 'stat' }, [
            el('div', { class: 'value' }, [summary?.balance != null ? String(summary.balance) : '—']),
            el('div', { class: 'label' }, ['Credits']),
          ]),
        ]),
        el('p', { class: 'muted' }, ['Plan changes, top-ups, connections, and members live in the web app — same account, same rules.']),
      ]),
      el('div', { class: 'card' }, [
        el('h2', {}, ['Your data']),
        el('p', { class: 'muted' }, [
          'Study data stays on this machine and is managed from the Review screen. Account data export and account deletion live at nibbin.com/app — deleting your account does not reach into this computer.',
        ]),
      ]),
    );
  }

  void refresh();
  void bridge.onEvent('auth:changed', () => void refresh());
  return root;
}
