//! Test/CI capture source: produces exactly the items a test queues.

use crate::{CaptureItem, CaptureSource, InputCounts};
use nibbin_redaction::AxSnapshot;
use std::collections::VecDeque;

#[derive(Default)]
pub struct MockCapture {
    queue: VecDeque<CaptureItem>,
    started: bool,
}

impl MockCapture {
    pub fn queue_snapshot(&mut self, snapshot: AxSnapshot) {
        self.queue.push_back(CaptureItem::Snapshot(snapshot));
    }
    pub fn queue_input(&mut self, input: InputCounts) {
        self.queue.push_back(CaptureItem::Input(input));
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

    fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CaptureItem, CaptureReadiness};

    #[test]
    fn mock_is_ready_by_default() {
        let m = MockCapture::default();
        assert!(matches!(m.readiness(), CaptureReadiness::Ready));
    }

    #[test]
    fn queued_input_drains_as_input_item() {
        let mut m = MockCapture::default();
        m.start().unwrap();
        m.queue_input(InputCounts {
            keys: 5,
            clicks: 2,
            duration_ms: 1200,
        });
        let items = m.poll().unwrap();
        assert_eq!(items.len(), 1);
        match &items[0] {
            CaptureItem::Input(c) => {
                assert_eq!(c.keys, 5);
                assert_eq!(c.clicks, 2);
            }
            _ => panic!("expected Input item"),
        }
    }
}
