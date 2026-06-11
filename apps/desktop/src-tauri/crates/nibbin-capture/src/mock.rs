//! Test/CI capture source: produces exactly the snapshots a test queues.

use crate::CaptureSource;
use nibbin_redaction::AxSnapshot;
use std::collections::VecDeque;

#[derive(Default)]
pub struct MockCapture {
    queue: VecDeque<AxSnapshot>,
    started: bool,
}

impl MockCapture {
    pub fn queue_snapshot(&mut self, snapshot: AxSnapshot) {
        self.queue.push_back(snapshot);
    }
}

impl CaptureSource for MockCapture {
    fn name(&self) -> &'static str {
        "mock"
    }

    fn start(&mut self) -> anyhow::Result<()> {
        self.started = true;
        Ok(())
    }

    fn poll(&mut self) -> anyhow::Result<Vec<AxSnapshot>> {
        if !self.started {
            return Ok(vec![]);
        }
        Ok(self.queue.drain(..).collect())
    }

    fn stop(&mut self) {
        self.started = false;
        self.queue.clear();
    }
}
