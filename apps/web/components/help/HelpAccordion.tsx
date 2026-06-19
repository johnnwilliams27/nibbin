"use client";
import type { HelpArticle } from "../../lib/help/types";
import styles from "./help.module.css";

export function HelpAccordion({
  article,
  open,
}: {
  article: HelpArticle;
  open?: boolean;
}) {
  return (
    <details className={styles.article} open={open}>
      <summary className={styles.articleQ}>{article.q}</summary>
      <div className={styles.articleBody}>
        {article.body.split("\n\n").map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </details>
  );
}
