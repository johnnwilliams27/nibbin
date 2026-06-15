//! Desktop sign-in (Stage B): native email/password login whose session is
//! persisted to the OS keychain. Tokens live in the OS keychain — never on
//! disk, never in the local DB (the SQLCipher store is study data only).
//! Sign-out-everywhere on the web side revokes the refresh token; the next
//! silent refresh here fails and the UI drops to signed-out.

/// Pinned Supabase origin — baked at build time per environment. Defaults to
/// PRODUCTION (nibbin-prod), where real user accounts live; override via
/// NIBBIN_SUPABASE_URL / NIBBIN_SUPABASE_PUBLISHABLE_KEY for dev/staging.
fn supabase_url() -> &'static str {
    option_env!("NIBBIN_SUPABASE_URL").unwrap_or("https://oaymttudfazqaqequrke.supabase.co")
}
fn supabase_publishable_key() -> &'static str {
    option_env!("NIBBIN_SUPABASE_PUBLISHABLE_KEY")
        .unwrap_or("sb_publishable_37WSmktUe1J5783qoGGKZA_oSaCgDTV")
}

const KEYRING_SERVICE: &str = "com.nibbin.observer";
const KEYRING_SESSION: &str = "supabase-session";

/// Persist a Supabase session obtained from the in-app login into the keychain.
#[tauri::command]
pub fn store_session(session: serde_json::Value) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION)
        .and_then(|e| e.set_password(&session.to_string()))
        .map_err(|e| e.to_string())
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
