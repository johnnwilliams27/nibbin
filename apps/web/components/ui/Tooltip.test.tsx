import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Tooltip, InfoTooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders children and tooltip content with role=tooltip", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Helpful hint">
        <button type="button">Hover me</button>
      </Tooltip>
    );
    expect(html).toContain("Helpful hint");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Hover me");
  });

  it("renders with side=bottom without crashing", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Below tip" side="bottom">
        <span>Anchor</span>
      </Tooltip>
    );
    expect(html).toContain("Below tip");
    expect(html).toContain('role="tooltip"');
  });

  it("defaults side to top when omitted", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Default side">
        <span>X</span>
      </Tooltip>
    );
    expect(html).toContain("Default side");
    expect(html).toContain('role="tooltip"');
  });

  it("links bubble id to trigger via aria-describedby", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Linked tip">
        <button type="button">Trigger</button>
      </Tooltip>
    );
    // aria-describedby on the trigger must reference the bubble id
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('id="');
    // The id value on the bubble must match aria-describedby on the trigger
    const describedByMatch = html.match(/aria-describedby="([^"]+)"/);
    const bubbleIdMatch = html.match(/id="([^"]+)"/);
    expect(describedByMatch).not.toBeNull();
    expect(bubbleIdMatch).not.toBeNull();
    if (describedByMatch && bubbleIdMatch) {
      expect(describedByMatch[1]).toBe(bubbleIdMatch[1]);
    }
  });

  it("merges existing aria-describedby on the child element", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Merged">
        <button type="button" aria-describedby="existing-id">Trigger</button>
      </Tooltip>
    );
    expect(html).toMatch(/aria-describedby="existing-id [^"]+"/);
  });
});

describe("InfoTooltip", () => {
  it("renders a button element", () => {
    const html = renderToStaticMarkup(<InfoTooltip content="More details" />);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("uses default aria-label when label not provided", () => {
    const html = renderToStaticMarkup(<InfoTooltip content="Info here" />);
    expect(html).toContain('aria-label="More info"');
  });

  it("uses custom aria-label when label is provided", () => {
    const html = renderToStaticMarkup(
      <InfoTooltip content="Custom label" label="Learn about fees" />
    );
    expect(html).toContain('aria-label="Learn about fees"');
  });

  it("renders tooltip content with role=tooltip", () => {
    const html = renderToStaticMarkup(<InfoTooltip content="Explanation text" />);
    expect(html).toContain("Explanation text");
    expect(html).toContain('role="tooltip"');
  });
});
