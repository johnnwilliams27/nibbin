//! observerd entrypoint.
//!
//!   observerd --store <dir> [--once] [--interval-ms <n>]
//!
//! `--once` performs a single heartbeat (control drain → C2 tick → capture
//! pass → status write) and exits — used by health checks and by the
//! process-level day-14 test (a real observerd process, no UI anywhere).

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

    let mut daemon = Daemon::open(&store, nibbin_capture::platform_source())?;

    loop {
        daemon.drain_control()?;
        daemon.tick()?;
        daemon.capture_pass()?;
        daemon.write_status()?;
        if once {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(interval_ms));
    }
}
