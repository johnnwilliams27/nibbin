//! Desktop sign-in (§6.1): system-browser OAuth/magic-link with a
//! `nibbin://auth` deep-link callback, PKCE end to end. Tokens live in the
//! OS keychain — never on disk, never in the local DB (the SQLCipher store
//! is study data only). Sign-out-everywhere on the web side revokes the
//! refresh token; the next silent refresh here fails and the UI drops to
//! signed-out.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Pinned origins — like the web app, the desktop NEVER derives auth origins
/// from anything attacker-controllable (GOTCHAS: pinned redirect origins).
/// Baked at build time per environment.
fn supabase_url() -> &'static str {
    option_env!("NIBBIN_SUPABASE_URL").unwrap_or("https://oqnqzytctwlptfdvyagl.supabase.co")
}
fn supabase_publishable_key() -> &'static str {
    option_env!("NIBBIN_SUPABASE_PUBLISHABLE_KEY").unwrap_or("")
}

const KEYRING_SERVICE: &str = "com.nibbin.observer";
const KEYRING_SESSION: &str = "supabase-session";
const REDIRECT: &str = "nibbin://auth";

static PENDING_VERIFIER: Mutex<Option<String>> = Mutex::new(None);

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn new_verifier() -> Result<String, anyhow::Error> {
    let mut random = [0u8; 48];
    getrandom::getrandom(&mut random)?;
    Ok(b64url(&random))
}

/// Start sign-in: open the SYSTEM browser (never an embedded webview) at the
/// provider authorize URL with our PKCE challenge and the deep-link redirect.
#[tauri::command]
pub fn auth_start(app: AppHandle, provider: String, email: Option<String>) -> Result<(), String> {
    auth_start_inner(&app, &provider, email.as_deref()).map_err(|e| e.to_string())
}

fn auth_start_inner(
    app: &AppHandle,
    provider: &str,
    email: Option<&str>,
) -> Result<(), anyhow::Error> {
    let verifier = new_verifier()?;
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    *PENDING_VERIFIER.lock().expect("verifier lock") = Some(verifier);

    match provider {
        "google" | "apple" => {
            let url = format!(
                "{}/auth/v1/authorize?provider={}&redirect_to={}&code_challenge={}&code_challenge_method=s256",
                supabase_url(),
                provider,
                urlencode(REDIRECT),
                challenge,
            );
            app.opener().open_url(url, None::<&str>)?;
        }
        "magic" => {
            let email = email.ok_or_else(|| anyhow::anyhow!("magic link needs an email"))?;
            let response = ureq::post(&format!("{}/auth/v1/otp", supabase_url()))
                .set("apikey", supabase_publishable_key())
                .send_json(serde_json::json!({
                    "email": email,
                    "create_user": true,
                    "code_challenge": challenge,
                    "code_challenge_method": "s256",
                    "options": { "email_redirect_to": REDIRECT },
                }))?;
            anyhow::ensure!(response.status() < 300, "otp request failed");
        }
        other => anyhow::bail!("unknown provider: {other}"),
    }
    Ok(())
}

/// Deep-link callback: nibbin://auth?code=... → PKCE token exchange → keychain.
pub fn complete_from_url(_app: &AppHandle, url: &str) -> Result<(), anyhow::Error> {
    let parsed = url::Url::parse(url)?;
    let code = parsed
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .ok_or_else(|| anyhow::anyhow!("auth callback had no code"))?;

    let verifier = PENDING_VERIFIER
        .lock()
        .expect("verifier lock")
        .take()
        .ok_or_else(|| anyhow::anyhow!("no sign-in in progress (verifier missing)"))?;

    let response = ureq::post(&format!("{}/auth/v1/token?grant_type=pkce", supabase_url()))
        .set("apikey", supabase_publishable_key())
        .send_json(serde_json::json!({ "auth_code": code, "code_verifier": verifier }))?;
    anyhow::ensure!(response.status() < 300, "token exchange failed");
    let session: serde_json::Value = response.into_json()?;

    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION)?.set_password(&session.to_string())?;
    Ok(())
}

/// Current session for the account module. Refreshes silently when expired;
/// a revoked refresh token (web "sign out everywhere") clears the session.
#[tauri::command]
pub fn auth_session() -> Result<Option<serde_json::Value>, String> {
    auth_session_inner().map_err(|e| e.to_string())
}

fn auth_session_inner() -> Result<Option<serde_json::Value>, anyhow::Error> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION)?;
    let stored = match entry.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let session: serde_json::Value = serde_json::from_str(&stored)?;

    let expires_at = session
        .get("expires_at")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if chrono::Utc::now().timestamp() < expires_at - 60 {
        return Ok(Some(session));
    }

    // silent refresh
    let Some(refresh_token) = session.get("refresh_token").and_then(|v| v.as_str()) else {
        entry.delete_credential()?;
        return Ok(None);
    };
    let response = ureq::post(&format!(
        "{}/auth/v1/token?grant_type=refresh_token",
        supabase_url()
    ))
    .set("apikey", supabase_publishable_key())
    .send_json(serde_json::json!({ "refresh_token": refresh_token }));
    match response {
        Ok(r) if r.status() < 300 => {
            let fresh: serde_json::Value = r.into_json()?;
            entry.set_password(&fresh.to_string())?;
            Ok(Some(fresh))
        }
        _ => {
            // revoked (sign-out-everywhere) or unreachable: drop to signed-out
            entry.delete_credential()?;
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn sign_out() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn urlencode(s: &str) -> String {
    s.replace(':', "%3A").replace('/', "%2F")
}
