//! Event schema v1 (SPEC §5). The persisted event carries ONLY redacted text
//! and a value CLASS — field values are classified and discarded; keystroke
//! contents are never recorded (counts/timing only).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Focus,
    AxDelta,
    Nav,
    InputBurst,
    FileDialog,
    ClipboardMeta,
    CaptureGap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AxAction {
    Press,
    Select,
    Edit,
    Scroll,
    Read,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueClass {
    Currency,
    Date,
    Email,
    Freeform,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Auto,
    UserKept,
    UserDeleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppRef {
    pub bundle_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowRef {
    pub title_redacted: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlRef {
    pub host: String,
    pub path_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AxRef {
    pub role_path: String,
    pub action: AxAction,
    pub label_redacted: String,
    pub value_class: ValueClass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputRef {
    pub keys: u32,
    pub clicks: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionMeta {
    pub rules_hit: Vec<String>,
    pub review_state: ReviewState,
}

/// The persisted, post-redaction event. Append-only during a study.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObserverEvent {
    pub v: u8,
    pub id: String,
    pub ts: String,
    pub session: String,
    pub kind: EventKind,
    pub app: AppRef,
    pub window: WindowRef,
    pub url: Option<UrlRef>,
    pub ax: Option<AxRef>,
    pub input: Option<InputRef>,
    pub frame_ref: Option<String>,
    pub redaction: RedactionMeta,
}

/// A raw AX observation. Secure fields (C4) are suppressed structurally at
/// construction: the `SecureSuppressed` variant has no label and no value
/// field at the type level — the content cannot exist in this shape.
#[derive(Debug, Clone)]
pub enum AxObservation {
    Plain {
        role_path: String,
        action: AxAction,
        label: String,
        value: Option<String>,
    },
    SecureSuppressed {
        role_path: String,
        action: AxAction,
    },
}

/// A raw capture observation, alive only between capture and the pipeline.
/// There is no Serialize impl on purpose: raw events must never be written.
#[derive(Debug, Clone)]
pub struct RawCaptureEvent {
    pub id: String,
    pub ts: String,
    pub session: String,
    pub kind: EventKind,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: String,
    pub window_id: String,
    pub window_category: Option<String>,
    pub url: Option<String>,
    pub ax: Option<AxObservation>,
    pub input: Option<InputRef>,
    pub frame_ref: Option<String>,
}
