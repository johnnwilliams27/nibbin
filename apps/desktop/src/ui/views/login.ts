import { supabase } from '../supabase.js';
import { bridge } from '../bridge.js';
import { button, el } from '../dom.js';

export function loginView(onSignedIn: () => void): HTMLElement {
  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' }) as HTMLInputElement;
  const pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' }) as HTMLInputElement;
  const err = el('p', { class: 'error', role: 'alert' });
  const submit = button('Sign in', () => void go(), 'primary');

  async function go(): Promise<void> {
    err.textContent = '';
    submit.setAttribute('disabled', 'true');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.value.trim(),
        password: pass.value,
      });
      if (error || !data.session) {
        err.textContent = error?.message ?? 'Sign-in failed.';
        return;
      }
      await bridge.storeSession(data.session as unknown as Record<string, unknown>);
      onSignedIn();
    } catch (e) {
      // Surface anything thrown (network/CSP fetch failure, keychain write
      // error) instead of failing silently.
      err.textContent = e instanceof Error ? e.message : `Sign-in failed: ${String(e)}`;
      console.error('login error', e);
    } finally {
      submit.removeAttribute('disabled');
    }
  }

  return el('div', { class: 'login-wrap' }, [
    el('div', { class: 'login-gate' }, [
      el('p', { class: 'eyebrow' }, ['Welcome back']),
      el('h1', {}, ['Nibbin']),
      el('p', { class: 'muted' }, ['Sign in to your grove.']),
      el('label', {}, ['Email', email]),
      el('label', {}, ['Password', pass]),
      err,
      submit,
    ]),
  ]);
}
