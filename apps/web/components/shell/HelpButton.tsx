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
      ?
    </Link>
  );
}
