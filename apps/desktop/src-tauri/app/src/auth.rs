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

/// Project a Supabase session down to only the fields we persist: the tokens +
/// expiry. The raw login/refresh response also carries the full `user` object,
/// identities, and metadata; the Windows Credential Manager caps a credential
/// blob at 2560 chars and the full payload overflows it. Every keychain write
/// (the login store AND the silent-refresh writeback) must go through this, or
/// `set_password` errors and the caller boots to a blank window.
fn minimal_session(session: &serde_json::Value) -> serde_json::Value {
    let mut minimal = serde_json::Map::new();
    for k in [
        "access_token",
        "refresh_token",
        "expires_at",
        "expires_in",
        "token_type",
    ] {
        if let Some(v) = session.get(k) {
            minimal.insert(k.to_string(), v.clone());
        }
    }
    serde_json::Value::Object(minimal)
}

/// Persist a Supabase session obtained from the in-app login into the keychain,
/// minimized to fit the Windows Credential Manager blob limit (see
/// [`minimal_session`]).
#[tauri::command]
pub fn store_session(session: serde_json::Value) -> Result<(), String> {
    let value = minimal_session(&session);
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION)
        .and_then(|e| e.set_password(&value.to_string()))
        .map_err(|e| e.to_string())
}

/// Read the access token + expiry from the stored keychain session, for the
/// Grove webview session handoff (`/desktop-auth`). The refresh token stays
/// native-side and is never handed to the webview. None when signed out.
pub fn session_tokens() -> Option<(String, i64)> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION).ok()?;
    let stored = entry.get_password().ok()?;
    let session: serde_json::Value = serde_json::from_str(&stored).ok()?;
    let access = session.get("access_token")?.as_str()?.to_string();
    let expires_at = session.get("expires_at")?.as_i64().unwrap_or(0);
    Some((access, expires_at))
}

/// The keychain access token, for Bearer-authing desktop→web API calls
/// (e.g. the study-packet upload). Refresh token stays in the keychain; neither
/// is ever placed in a URL.
#[tauri::command]
pub fn access_token() -> Option<String> {
    // Reuse auth_session_inner so an expired JWT is silently refreshed before
    // we hand it to a Bearer upload (a study can end hours/days after sign-in).
    let session = auth_session_inner().ok()??;
    session.get("access_token")?.as_str().map(str::to_string)
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
            // Minimize before persisting — the raw refresh response carries the
            // full user object and overflows the Windows Credential Manager
            // 2560-char limit, which would error the whole boot (blank window).
            let fresh = minimal_session(&r.into_json()?);
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

#[cfg(test)]
mod tests {
    use super::minimal_session;
    use serde_json::json;

    /// Mirrors a real Supabase refresh response (long JWT + heavy user object)
    /// and proves the projection both keeps the tokens and stays under the
    /// Windows Credential Manager 2560-char blob limit that the raw payload
    /// overflows. Regression guard for the silent-refresh writeback going blank.
    #[test]
    fn minimal_session_keeps_tokens_and_fits_credential_manager_limit() {
        let access = "a".repeat(1300);
        let full = json!({
            "access_token": access.clone(),
            "refresh_token": "refresh-token-value",
            "expires_at": 2_000_000_000_i64,
            "expires_in": 3600,
            "token_type": "bearer",
            "user": {
                "id": "00000000-0000-0000-0000-000000000000",
                "email": "person@example.com",
                "user_metadata": { "blob": "x".repeat(5000) },
                "identities": [ { "data": "y".repeat(3000) } ]
            }
        });

        // The unminimized response would blow the limit…
        assert!(full.to_string().len() > 2560);

        let min = minimal_session(&full);

        // …tokens + expiry survive…
        assert_eq!(min["access_token"], json!(access));
        assert_eq!(min["refresh_token"], json!("refresh-token-value"));
        assert_eq!(min["expires_at"], json!(2_000_000_000_i64));
        // …the heavyweight fields are dropped…
        assert!(min.get("user").is_none());
        // …and the stored blob fits.
        assert!(
            min.to_string().len() < 2560,
            "minimal blob = {} chars",
            min.to_string().len()
        );
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
