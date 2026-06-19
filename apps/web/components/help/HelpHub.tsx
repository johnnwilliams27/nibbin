"use client";
import { useState } from "react";
import type { HelpContent } from "../../lib/help/types";
import type { ConnectorEntry } from "../../lib/connections/catalog";
import type { ChecklistState } from "../../lib/help/checklist";
import { filterHelp } from "../../lib/help/content";
import { HelpSearch } from "./HelpSearch";
import { HelpAccordion } from "./HelpAccordion";
import { GettingStartedChecklist } from "./GettingStartedChecklist";
import { ConnectorDirectory } from "./ConnectorDirectory";
import styles from "./help.module.css";

export function HelpHub({
  content,
  connectors,
  checklist,
}: {
  content: HelpContent;
  connectors: ConnectorEntry[];
  checklist: ChecklistState;
}) {
  const [query, setQuery] = useState("");
  const sections = filterHelp(query, content);
  return (
    <div className={styles.hub}>
      <GettingStartedChecklist state={checklist} />
      <HelpSearch value={query} onChange={setQuery} />
      {sections.length === 0 && query.trim().length > 0 && (
        <p className={styles.empty}>No results for &ldquo;{query}&rdquo;.</p>
      )}
      {sections.map((s) => (
        <section key={s.id} id={s.id} className={styles.section}>
          <h2 className={styles.sectionTitle}>{s.title}</h2>
          {s.intro && <p className={styles.intro}>{s.intro}</p>}
          {s.articles.map((a) => (
            <HelpAccordion key={a.id} article={a} open={!!query} />
          ))}
          {s.id === "connections" && (
            <ConnectorDirectory connectors={connectors} heading="All connectors" />
          )}
        </section>
      ))}
    </div>
  );
}
