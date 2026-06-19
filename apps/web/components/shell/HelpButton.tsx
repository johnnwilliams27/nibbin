"use client";
import Link from "next/link";
import styles from "./shell.module.css";

export function HelpButton() {
  return (
    <Link
      href="/app/help"
      aria-label="Help & Getting Started"
      title="Help"
      className={styles.helpButton}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </Link>
  );
}
