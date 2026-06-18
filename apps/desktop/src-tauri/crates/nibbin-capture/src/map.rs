//! Pure mapping from the vendored screenpipe a11y types to Nibbin's AxSnapshot
//! (the shape nibbin-redaction consumes). C4: is_password → secure. No I/O.

use nibbin_redaction::capture_norm::{AxSnapshot, AxSnapshotNode, AxWindow};
use screenpipe_a11y::{AccessibilityNode, WindowTreeSnapshot};

/// Map one accessibility node (and its subtree) to an AxSnapshotNode.
/// C4: an OS-flagged password element sets `secure = Some(true)`.
pub fn node_to_ax(n: &AccessibilityNode) -> AxSnapshotNode {
    AxSnapshotNode {
        role: n.control_type.clone(),
        label: n.name.clone(),
        value: n.value.clone(),
        secure: if n.is_password == Some(true) {
            Some(true)
        } else {
            None
        },
        action: None,
        children: n.children.iter().map(node_to_ax).collect(),
    }
}

/// Map a captured focused-window tree into an AxSnapshot. `url` is the browser
/// URL when known (Lite has no frames → frame_ref None).
pub fn window_tree_to_snapshot(s: &WindowTreeSnapshot, url: Option<String>) -> AxSnapshot {
    AxSnapshot {
        window: AxWindow {
            app: s.app_name.clone(),
            bundle_id: None,
            title: s.window_title.clone().unwrap_or_default(),
            category: None,
            id: None,
        },
        url,
        ax_tree: node_to_ax(&s.root),
        frame_ref: None,
    }
}

/// Build an AxSnapshot from the raw parts the platform adapter has on hand
/// (app name, optional window title, captured root node, optional URL). This
/// avoids constructing a full `WindowTreeSnapshot` (which would need the
/// element count + tree hash that the adapter doesn't compute). C4 secure-field
/// suppression still happens structurally via `node_to_ax`.
pub fn parts_to_snapshot(
    app_name: String,
    window_title: Option<String>,
    root: &AccessibilityNode,
    url: Option<String>,
) -> AxSnapshot {
    AxSnapshot {
        window: AxWindow {
            app: app_name,
            bundle_id: None,
            title: window_title.unwrap_or_default(),
            category: None,
            id: None,
        },
        url,
        ax_tree: node_to_ax(root),
        frame_ref: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use screenpipe_a11y::AccessibilityNode;

    fn node(
        control_type: &str,
        value: Option<&str>,
        is_password: Option<bool>,
    ) -> AccessibilityNode {
        AccessibilityNode {
            control_type: control_type.to_string(),
            name: None,
            value: value.map(|s| s.to_string()),
            is_password,
            children: vec![],
            ..Default::default()
        }
    }

    #[test]
    fn password_node_maps_to_secure() {
        let ax = node_to_ax(&node("Edit", Some("hunter2"), Some(true)));
        assert_eq!(ax.role, "Edit");
        assert_eq!(ax.secure, Some(true));
    }

    #[test]
    fn non_password_node_is_not_secure() {
        assert_eq!(
            node_to_ax(&node("Edit", Some("hi"), Some(false))).secure,
            None
        );
        assert_eq!(node_to_ax(&node("Edit", Some("hi"), None)).secure, None);
    }

    #[test]
    fn children_recurse_and_value_carries() {
        let mut parent = node("Group", None, None);
        parent.children = vec![node("Edit", Some("hi"), None)];
        let ax = node_to_ax(&parent);
        assert_eq!(ax.children.len(), 1);
        assert_eq!(ax.children[0].value.as_deref(), Some("hi"));
    }

    #[test]
    fn parts_to_snapshot_carries_window_and_tree() {
        let mut root = node("Window", None, None);
        root.name = Some("Root".to_string());
        root.children = vec![node("Edit", Some("hi"), None)];
        let snap = parts_to_snapshot(
            "notepad.exe".to_string(),
            Some("Untitled - Notepad".to_string()),
            &root,
            None,
        );
        assert_eq!(snap.window.app, "notepad.exe");
        assert_eq!(snap.window.title, "Untitled - Notepad");
        assert_eq!(snap.ax_tree.role, "Window");
        assert_eq!(snap.ax_tree.children.len(), 1);
        assert_eq!(snap.url, None);
        assert!(snap.frame_ref.is_none());
    }

    #[test]
    fn parts_to_snapshot_missing_title_is_empty() {
        let root = node("Window", None, None);
        let snap = parts_to_snapshot("app.exe".to_string(), None, &root, None);
        assert_eq!(snap.window.title, "");
    }
}
