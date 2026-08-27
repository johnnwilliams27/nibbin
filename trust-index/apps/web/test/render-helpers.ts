/**
 * Shared helpers for rendering Server Component pages in tests without a
 * running Next.js server: our page components are plain async functions
 * that take a `params` promise and return JSX built only from our own
 * components (IntervalFigure, next/link, next/navigation's notFound), so
 * they can be invoked directly and rendered with react-dom/server.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

export function renderStatic(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

/**
 * Extracts the outer HTML of the first element carrying `attr="value"`,
 * using balanced-tag counting (regex alone cannot handle nesting). Used by
 * the D2a gate to isolate the score region before asserting on its content.
 */
export function extractByAttribute(html: string, attr: string, value: string): string {
  const openTagRe = /<([a-zA-Z0-9]+)((?:\s+[^<>]*)?)>/g;
  const marker = `${attr}="${value}"`;
  let match: RegExpExecArray | null;
  let startIndex = -1;
  let tagName = "";
  let afterOpenTag = -1;

  while ((match = openTagRe.exec(html)) !== null) {
    if (match[2]?.includes(marker)) {
      startIndex = match.index;
      tagName = match[1]!;
      afterOpenTag = match.index + match[0].length;
      break;
    }
  }
  if (startIndex === -1) {
    throw new Error(`no element with ${marker} found`);
  }

  const tagOpenRe = new RegExp(`<${tagName}(\\s[^<>]*)?>`, "g");
  const tagCloseRe = new RegExp(`</${tagName}>`, "g");

  let depth = 1;
  let cursor = afterOpenTag;
  while (depth > 0) {
    tagOpenRe.lastIndex = cursor;
    tagCloseRe.lastIndex = cursor;
    const nextOpen = tagOpenRe.exec(html);
    const nextClose = tagCloseRe.exec(html);
    if (!nextClose) throw new Error(`unbalanced <${tagName}> starting at ${startIndex}`);

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return html.slice(startIndex, cursor);
}
