//! DB key wrapping. The SQLCipher key is 32 random bytes that live ONLY in
//! the OS keystore (macOS Keychain; Windows Credential Manager, DPAPI-backed
//! — TPM wrapping is an M8 hardening item). Tests supply an explicit key.

use anyhow::Result;

pub trait KeyProvider {
    /// 32 bytes, lowercase hex (64 chars).
    fn key_hex(&self) -> Result<String>;
}

/// Explicit key for tests and the daemon simulator. Never used in release.
pub struct StaticTestKey(pub [u8; 32]);

impl KeyProvider for StaticTestKey {
    fn key_hex(&self) -> Result<String> {
        Ok(hex(&self.0))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Production key provider: fetches the wrapped key from the OS keystore,
/// generating and storing a fresh random key on first run.
#[cfg(feature = "os-keystore")]
pub struct OsKeystoreKey {
    pub service: String,
    pub account: String,
}

#[cfg(feature = "os-keystore")]
impl OsKeystoreKey {
    pub fn observer_default() -> Self {
        Self {
            service: "com.nibbin.observer".to_string(),
            account: "sqlcipher-db-key".to_string(),
        }
    }
}

#[cfg(feature = "os-keystore")]
impl KeyProvider for OsKeystoreKey {
    fn key_hex(&self) -> Result<String> {
        let entry = keyring::Entry::new(&self.service, &self.account)?;
        match entry.get_password() {
            Ok(existing) => Ok(existing),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                getrandom::getrandom(&mut key)?;
                let key_hex = hex(&key);
                entry.set_password(&key_hex)?;
                Ok(key_hex)
            }
            Err(e) => Err(e.into()),
        }
    }
}
