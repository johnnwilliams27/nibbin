//! Layer 1 — structural secure-field suppression (C4), applied AT CAPTURE.
//! `snapshot_to_raw_events` is the only constructor of RawCaptureEvent from
//! AX data; a node flagged secure by the OS yields an observation whose type
//! has no label/value field at all, with a forced-null frame.

use crate::event::{AxAction, AxObservation, EventKind, InputRef, RawCaptureEvent};
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};

/// AX snapshot shape produced by the platform capture impls (and by the
/// corpus fixtures — tests/redaction-corpus/fixtures drive this directly).
#[derive(Debug, Clone, Deserialize)]
pub struct AxSnapshot {
    pub window: AxWindow,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(rename = "axTree")]
    pub ax_tree: AxSnapshotNode,
    #[serde(default, rename = "frameRef")]
    pub frame_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AxWindow {
    pub app: String,
    #[serde(default, rename = "bundleId")]
    pub bundle_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AxSnapshotNode {
    pub role: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub secure: Option<bool>,
    #[serde(default)]
    pub action: Option<AxAction>,
    #[serde(default)]
    pub children: Vec<AxSnapshotNode>,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn event_id() -> String {
    format!("evt_{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

pub fn to_observation(node: &AxSnapshotNode, role_path: &str) -> AxObservation {
    if node.secure == Some(true) {
        AxObservation::SecureSuppressed {
            role_path: format!("{role_path}[secure]"),
            action: node.action.unwrap_or(AxAction::Read),
        }
    } else {
        AxObservation::Plain {
            role_path: role_path.to_string(),
            action: node.action.unwrap_or(AxAction::Read),
            label: node.label.clone().unwrap_or_default(),
            value: node.value.clone(),
        }
    }
}

fn flatten<'a>(
    node: &'a AxSnapshotNode,
    prefix: &str,
    out: &mut Vec<(&'a AxSnapshotNode, String)>,
) {
    let role_path = if prefix.is_empty() {
        node.role.clone()
    } else {
        format!("{prefix}/{}", node.role)
    };
    out.push((node, role_path.clone()));
    for child in &node.children {
        flatten(child, &role_path, out);
    }
}

/// Normalize an AX snapshot into raw capture events with C4 already applied.
pub fn snapshot_to_raw_events(
    snapshot: &AxSnapshot,
    session: &str,
    now_iso: &str,
) -> Vec<RawCaptureEvent> {
    let mut flat = Vec::new();
    flatten(&snapshot.ax_tree, "", &mut flat);

    flat.into_iter()
        .filter(|(node, _)| node.role != "window" && node.role != "group")
        .map(|(node, role_path)| {
            let obs = to_observation(node, &role_path);
            let secure = matches!(obs, AxObservation::SecureSuppressed { .. });
            RawCaptureEvent {
                id: event_id(),
                ts: now_iso.to_string(),
                session: session.to_string(),
                kind: EventKind::AxDelta,
                app_bundle_id: snapshot
                    .window
                    .bundle_id
                    .clone()
                    .unwrap_or_else(|| snapshot.window.app.clone()),
                app_name: snapshot.window.app.clone(),
                window_title: snapshot.window.title.clone(),
                window_id: snapshot
                    .window
                    .id
                    .clone()
                    .unwrap_or_else(|| "w_unknown".to_string()),
                window_category: snapshot.window.category.clone(),
                url: snapshot.url.clone(),
                ax: Some(obs),
                input: None::<InputRef>,
                // C4: secure observations can never carry a frame.
                frame_ref: if secure {
                    None
                } else {
                    snapshot.frame_ref.clone()
                },
            }
        })
        .collect()
}
