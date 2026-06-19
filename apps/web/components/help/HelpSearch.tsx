"use client";
import styles from "./help.module.css";

export function HelpSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className={styles.search}
      type="search"
      placeholder="Search help — features, setup, privacy, connectors…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Search help"
    />
  );
}
