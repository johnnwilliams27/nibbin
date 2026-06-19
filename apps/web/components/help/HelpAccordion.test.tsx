import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpAccordion } from "./HelpAccordion";

describe("HelpAccordion", () => {
  it("renders the question and body", () => {
    const html = renderToStaticMarkup(
      <HelpAccordion
        article={{ id: "a", q: "How do I start?", body: "Install the app." }}
      />
    );
    expect(html).toContain("How do I start?");
    expect(html).toContain("Install the app.");
  });

  it("is open by default when open prop is true", () => {
    const html = renderToStaticMarkup(
      <HelpAccordion
        article={{ id: "b", q: "Question?", body: "Answer." }}
        open={true}
      />
    );
    expect(html).toContain("open");
  });

  it("splits body paragraphs on double newline", () => {
    const html = renderToStaticMarkup(
      <HelpAccordion
        article={{ id: "c", q: "Q?", body: "Para one.\n\nPara two." }}
      />
    );
    expect(html).toContain("Para one.");
    expect(html).toContain("Para two.");
  });
});
