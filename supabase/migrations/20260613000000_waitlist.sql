-- Landing-page waitlist ("Join the Founding Grove — 100 seats"). Double-opt-in:
-- a row lands 'pending' on submit and flips to 'confirmed' only after the
-- emailed HMAC link is clicked (CAN-SPAM-clean: we never bulk-mail an address
-- that didn't confirm). Holds bare email addresses → service-role only, like
-- email_sends/email_suppressions; no client policies.

create table public.waitlist (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  source text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- last confirmation email sent — the server enforces a resend cooldown
  -- against this so re-submitting can't spray a targeted address.
  last_email_sent_at timestamptz
);
create index waitlist_status_idx on public.waitlist (status, created_at);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

-- A confirmed seat is structural: nothing can downgrade it back to pending,
-- even if the app layer's guard is bypassed by a transient DB error.
create function private.waitlist_no_downgrade()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'confirmed' and new.status <> 'confirmed' then
    raise exception 'cannot downgrade a confirmed waitlist row';
  end if;
  return new;
end;
$$;

create trigger waitlist_no_downgrade
  before update on public.waitlist
  for each row execute function private.waitlist_no_downgrade();
