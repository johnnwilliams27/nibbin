import type { ReactNode } from "react";
import styles from "./tooltip.module.css";

// ---- Tooltip ---------------------------------------------------------------

export interface TooltipProps {
  /** Content rendered inside the tooltip bubble. */
  content: ReactNode;
  /** The element that acts as the hover/focus trigger. */
  children: ReactNode;
  /** Which side the bubble appears on (default: "top"). */
  side?: "top" | "bottom";
}

/**
 * CSS-only tooltip wrapper. Shows a styled bubble on hover and keyboard
 * focus-within. No JS, no "use client" — fully server-component compatible.
 *
 * Wrap any trigger element: the wrapper gains `position: relative` and the
 * bubble is absolutely positioned relative to it.
 *
 * @example
 * <Tooltip content="Remove this item">
 *   <button type="button">Delete</button>
 * </Tooltip>
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const bubbleClass = [
    styles.bubble,
    side === "bottom" ? styles.bubbleBottom : styles.bubbleTop,
  ].join(" ");

  return (
    <span className={styles.root}>
      {children}
      <span role="tooltip" className={bubbleClass}>
        {content}
      </span>
    </span>
  );
}

// ---- InfoTooltip -----------------------------------------------------------

export interface InfoTooltipProps {
  /** Content rendered inside the tooltip bubble. */
  content: ReactNode;
  /** Accessible label for the "?" button (default: "More info"). */
  label?: string;
}

/**
 * Inline "?" info icon that reveals a tooltip on hover/focus.
 * Renders a small circular button so keyboard users can tab to it.
 * Compose it next to any label or description that warrants elaboration.
 *
 * @example
 * <label>
 *   Sweep window <InfoTooltip content="How often we check for new email" />
 * </label>
 */
export function InfoTooltip({ content, label }: InfoTooltipProps) {
  return (
    <Tooltip content={content} side="top">
      <button
        type="button"
        className={styles.infoBtn}
        aria-label={label ?? "More info"}
      >
        ?
      </button>
    </Tooltip>
  );
}
