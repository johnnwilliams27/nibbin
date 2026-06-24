//! observerd entrypoint.
//!
//!   observerd --store <dir> [--once] [--interval-ms <n>]
//!
//! `--once` performs a single heartbeat (control drain → C2 tick → capture
//! pass → status write) and exits — used by health checks and by the
//! process-level day-14 test (a real observerd process, no UI anywhere).

#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use observerd::watchdog::Watchdog;
use observerd::Daemon;
use std::path::PathBuf;
use std::time::Duration;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let mut store: Option<PathBuf> = None;
    let mut once = false;
    let mut interval_ms: u64 = 250;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--store" => store = Some(PathBuf::from(args.next().expect("--store needs a path"))),
            "--once" => once = true,
            "--interval-ms" => {
                interval_ms = args.next().expect("--interval-ms needs a value").parse()?;
            }
            other => anyhow::bail!("unknown argument: {other}"),
        }
    }
    let store = store.expect("usage: observerd --store <dir> [--once]");

    // P-CB6: run the capture daemon below normal priority so it never competes
    // with the user's foreground work. No-op on platforms without an impl.
    nibbin_capture::set_low_process_priority();

    let mut daemon = Daemon::open(&store, nibbin_capture::platform_source())?;

    // 0.2.5: self-suspend watchdog (defense-in-depth). Claims the daemon lease
    // on startup (a strictly-newer start time than any prior daemon's, so an
    // orphaned old instance sees itself superseded). Skipped in --once mode,
    // which is a single synchronous heartbeat for health checks/tests.
    let mut watchdog = (!once).then(|| Watchdog::new(&store));

    loop {
        daemon.drain_control()?;
        daemon.tick()?;
        daemon.capture_pass()?;
        daemon.maybe_generate_field_notes();
        daemon.write_status()?;
        if once {
            return Ok(());
        }
        // After a full pass, ask the watchdog whether this daemon still has any
        // reason to run. If not, stop the capture source and exit the process —
        // the daemon must never keep capturing (or lingering) when it shouldn't.
        if let Some(wd) = watchdog.as_mut() {
            if let Some(reason) = wd.should_exit() {
                daemon.shutdown_capture();
                eprintln!("observerd self-exit: {reason:?}");
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(interval_ms));
    }
}
