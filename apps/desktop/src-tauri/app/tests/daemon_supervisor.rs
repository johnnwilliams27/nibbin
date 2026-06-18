#[test]
fn binary_name_is_platform_correct() {
    let name = nibbin_observer_app::daemon_supervisor::observerd_binary_name();
    #[cfg(windows)]
    assert_eq!(name, "observerd.exe");
    #[cfg(not(windows))]
    assert_eq!(name, "observerd");
}

#[test]
fn plist_has_required_keys() {
    let p = nibbin_observer_app::daemon_supervisor::launchagent_plist(
        std::path::Path::new("/Applications/Nibbin.app/observerd"),
        std::path::Path::new("/Users/x/Library/Application Support/app.nibbin.observer/observer-store"),
    );
    assert!(p.contains("app.nibbin.observerd"));
    assert!(p.contains("<string>--store</string>"));
    assert!(p.contains("/observerd</string>"));
    assert!(p.contains("RunAtLoad"));
    assert!(p.contains("KeepAlive"));
}
