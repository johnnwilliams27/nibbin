#[test]
fn binary_name_is_platform_correct() {
    let name = nibbin_observer_app::daemon_supervisor::observerd_binary_name();
    #[cfg(windows)]
    assert_eq!(name, "observerd.exe");
    #[cfg(not(windows))]
    assert_eq!(name, "observerd");
}
