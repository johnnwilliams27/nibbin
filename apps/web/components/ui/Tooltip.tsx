"use client";

import { useId, cloneElement, isValidElement } from "react";
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
 * focus-within. No JS state — the `useId` call is for aria wiring only.
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
  const bubbleId = useId();
  const bubbleClass = [
    styles.bubble,
    side === "bottom" ? styles.bubbleBottom : styles.bubbleTop,
  ].join(" ");

  // Wire aria-describedby onto the trigger child so screen readers announce
  // the tooltip when the child receives focus.
  let trigger: ReactNode;
  if (isValidElement<{ "aria-describedby"?: string }>(children)) {
    const existing = (children.props as { "aria-describedby"?: string })["aria-describedby"];
    trigger = cloneElement(children, {
      "aria-describedby": existing ? `${existing} ${bubbleId}` : bubbleId,
    });
  } else {
    trigger = <span aria-describedby={bubbleId}>{children}</span>;
  }

  return (
    <span className={styles.root}>
      {trigger}
      <span id={bubbleId} role="tooltip" className={bubbleClass}>
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
