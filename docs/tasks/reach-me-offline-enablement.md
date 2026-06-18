# Reach-Me — Offline Enablement Checklist (SMS + WhatsApp)

Source: spec §16 + D-N4. ⚑ = needs the user / counsel / an external account; cannot be done from the codebase.
Gate: the matching `CHANNELS_*_ENABLED` flag stays FALSE until its whole section is checked.

## SMS / Twilio (the long pole — start FIRST; carrier registration is multi-day)
- [ ] ⚑ Create/confirm the Twilio account; record the Account SID.
- [ ] ⚑ 10DLC **Brand registration** (legal entity, EIN) — submit; wait for vetting.
- [ ] ⚑ 10DLC **Campaign registration** (use-case: account notifications + 2-way) — submit; wait for carrier approval (multi-day).
- [ ] ⚑ Provision a 10DLC phone number; attach to the approved campaign.
- [ ] ⚑ Counsel: review TCPA consent language + quiet-hours policy + record-keeping.
- [ ] In-repo: opt-in consent copy + STOP/HELP handler shipped (Tasks 2–3 below).
- [ ] **In-repo (pre-go-live): wire the inbound `START` re-subscribe handler.** The CTIA `START` keyword is recognized by `isStartKeyword`, but the SMS route currently acts only on STOP/HELP — an opted-out number that texts START will NOT auto-resume. Before flipping the flag, add a START branch that replies pointing the user to reconnect in the app (re-binding requires the authenticated nonce; do NOT auto-un-revoke from a bare SMS — that would bypass the link-verification security model).
- [ ] **Apply the `sms_opt_out` RPC migration (`20260618090000`) to dev/staging/prod BEFORE flipping the flag.** If the RPC is absent at runtime, `optOutSms` silently degrades to log-only — a TCPA opt-out gap exactly when it matters.
- [ ] ⚑ Configure the Twilio messaging webhook → `https://nibbin.com/api/channels/sms` with request-signature validation on.
- [ ] Set env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_WEBHOOK_URL`, `TWILIO_PER_MESSAGE_MICROUSD`.
- [ ] ⚑ COGS modeling: fold per-message SMS cost into the unit-economics model; tune the §11 SMS sub-cap (`smsSpendCapMicroUsd`).
- [ ] Flip `CHANNELS_SMS_ENABLED=true` (dev → staging → prod) once all above are checked.

## WhatsApp Business
- [ ] ⚑ Meta Business verification.
- [ ] ⚑ WhatsApp Business API access; create the phone number; record `WHATSAPP_PHONE_NUMBER_ID`.
- [ ] ⚑ Submit + get approval for the proactive-escalation **message template(s)**.
- [ ] ⚑ Configure the Meta webhook → `https://nibbin.com/api/channels/whatsapp` with the verify token + app secret.
- [ ] Set env: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PER_MESSAGE_MICROUSD`.
- [ ] Flip `CHANNELS_WHATSAPP_ENABLED=true` once all above are checked.

## Telegram (mostly in-repo — included for completeness)
- [ ] ⚑ Create the bot via BotFather; record `TELEGRAM_BOT_TOKEN` + bot username (`NEXT_PUBLIC_TELEGRAM_BOT`).
- [ ] ⚑ Set the Telegram webhook → `https://nibbin.com/api/channels/telegram` with a secret token (`TELEGRAM_WEBHOOK_SECRET`).
- [ ] Set env (above) in dev/staging/prod.

## Cross-cutting (gates ALL channels)
- [ ] ⚑ Subprocessor registry: publish Twilio + Telegram + Meta entries (regions, data categories, retention) — data prepared in Task 4; ⚑ = publish + counsel sign-off.
- [ ] ⚑ Privacy/legal: provider-retention disclosure (D-N3) folded into the #46 attorney review; SMS consent record-keeping confirmed.
