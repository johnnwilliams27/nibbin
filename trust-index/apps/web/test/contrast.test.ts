import { describe, expect, it } from "vitest";
import { AA_GRAPHIC_PAIRS, AA_TEXT_PAIRS, PALETTE } from "@/lib/tokens";

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [channel(r), channel(g), channel(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("WCAG AA contrast (SPEC 14.1 quality floor)", () => {
  it.each(AA_TEXT_PAIRS)("text pair %s on %s clears 4.5:1", (fg, bg) => {
    const ratio = contrastRatio(PALETTE[fg], PALETTE[bg]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(AA_GRAPHIC_PAIRS)("graphic pair %s on %s clears 3:1 (WCAG 1.4.11)", (fg, bg) => {
    const ratio = contrastRatio(PALETTE[fg], PALETTE[bg]);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("has no verdict colors: no red, green, or amber hue in the palette", () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      const [r, g, b] = hexToRgb(hex);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta < 12) continue; // near-neutral, no meaningful hue
      let hue = 0;
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
      const isRed = hue < 15 || hue > 345;
      const isGreen = hue > 90 && hue < 150;
      const isAmber = hue > 30 && hue < 60 && delta > 60;
      expect({ name, hue, isRed, isGreen, isAmber }).toEqual({
        name,
        hue,
        isRed: false,
        isGreen: false,
        isAmber: false,
      });
    }
  });
});
