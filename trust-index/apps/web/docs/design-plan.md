# Design plan for the trust index surface

Written before any UI code, per SPEC 14.1. The critique pass and the revisions
it forced are recorded at the end of this file.

## Register

This is an instrument for reading evidence about machine counterparties. The
model is a measurement readout: a lab log sheet, a calibration certificate, a
metering panel. Not a fintech dashboard, not a crypto landing page. Every
design decision below follows from one rule: the page reports measurements and
their uncertainty, and it never renders a verdict.

## Palette

Six named hexes. These live in `src/lib/tokens.ts`, the only source of color
values in the app. A unit test (`test/contrast.test.ts`) verifies every pair
used for text meets WCAG AA computationally.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#1B2228` | Primary text. Near-black with a cool cast. |
| `paper` | `#F2F3F0` | Page ground. Cool grey-green off-white, the color of instrument enclosures and log paper. |
| `slate` | `#4A5560` | Secondary text: labels, captions, table headers. 6.8:1 on paper. |
| `band` | `#2E5E79` | The interval band fill. Desaturated steel blue. 6.3:1 on paper as a graphic. |
| `marker` | `#143C57` | Point-estimate marker, links, focus ring. 10.4:1 on paper. |
| `hairline` | `#D7DAD3` | Rules and table borders. Decorative separators only, never text. |

Measured contrast: ink on paper 14.4:1, slate on paper 6.8:1, marker on paper
10.4:1, band against paper 6.3:1. All text pairs clear AA for normal text.

### Why this palette is not a banned stock look, and not verdict-colored

The three banned looks are warm-cream with a serif and a terracotta accent,
near-black with a single acid accent, and broadsheet hairline-rule pastiche.
This palette is none of them. The ground is a cool grey-green, not a warm
cream, and no terracotta or warm accent exists anywhere in the system. The
scheme is light-on-paper, not near-black, and the accent is a desaturated
steel blue at 6.3:1, the opposite of an acid accent. Hairlines appear only as
table borders and section rules at functional density, with sans-serif type
and no editorial column furniture, so it does not read as a newspaper
pastiche. The palette is also verdict-free: there is no green, no red, and no
amber. Tier and confidence are encoded by band width, band position, and a
neutral text label. The steel blue is used identically for a strong interval
and a thin one; only geometry differs. A colorblind reader and a grayscale
printout lose nothing.

## Typefaces by role

Numbers are the content, so the data face was chosen first. Both families are
self-hosted woff2 files loaded through `next/font/local`. No font CDN is
touched at runtime or at build.

| Role | Face | Notes |
|---|---|---|
| Data | IBM Plex Mono (400, 500) | Every numeral on the site. Monospaced, so figures are tabular by construction, including interval labels, table cells, and axis ticks. `font-variant-numeric: tabular-nums` is set as well. |
| Body | IBM Plex Sans (variable) | Dense technical prose. Grotesque with an engineering lineage, good at small sizes. |
| Headings | IBM Plex Sans, weight 600 | Sentence case throughout. Same family as body: headings differ by weight and size only. |

Fallback stacks: the mono face falls back to `ui-monospace, "Cascadia Mono",
"Roboto Mono", monospace`; the sans falls back to `system-ui, "Segoe UI",
Helvetica, Arial, sans-serif`.

## Layout concept: the log sheet

One centered measurement column, about 68 characters wide for prose, with data
tables allowed to extend to a wider max width. Sections are separated by
hairline rules, not cards or shadows. Each section opens with a small slate
label in the manner of a form field on a calibration certificate. Every number
is set in the mono face and links to its derivation. No hero, no feature
grid, no CTA banner: the homepage states the thesis in prose, shows one worked
interval figure from a committed fixture, and links to the methodology.

Navigation is a single top bar: plain wordmark on the left, five text links on
the right. The favicon is the wordmark initial.

## Signature element: the interval

Every score renders as a forest-plot row: a horizontal 0 to 100 axis with
faint gridlines, the 95% band as a steel-blue bar, a vertical marker at the
point estimate, and `n_eff` printed beside the band in the mono face. Numbers
for low, point, and high sit under their positions. Two agents at 72 look
different at a glance because one band is 6 points wide and the other is 40.
The band scales in from the marker on load (transform only, about 400ms) and
the animation is removed entirely under `prefers-reduced-motion`. Suppressed
agents never get this element in any form: the score region renders the
suppression reason and the evidence summary, with no numeral in that region.

Everything around the interval stays quiet: no icons, no badges, no color
coding of tiers. Coverage tier and lifecycle state are plain text labels in
slate.

## Critique pass

Read against the brief after the first draft. Findings and the revisions they
forced:

1. The first draft had a seventh token, a muted amber `#8A6D2F`, for marking
   thin coverage rows and the provisional badge. That is a verdict color:
   amber reads as warning, which turns a coverage statement into a judgment.
   Removed. Thin coverage is now carried by band geometry and the words
   "coverage: thin"; provisional constants are marked with the word
   "provisional" in slate.
2. The first draft used a characterful display serif for page titles. Against
   the brief it pulled the pages toward the broadsheet pastiche and it added a
   third family for no measurable gain. Dropped: headings are Plex Sans 600.
3. The first draft dimmed the interval and rendered the score at 40% opacity
   for suppressed agents. That violates the spec directly: a greyed numeral is
   still a numeral. The suppressed state now renders prose only, and a test
   asserts the score region contains no digits at all.
4. The first draft put the interval axis at the top of the agent page with the
   identity block below it. Reversed: an unlabeled measurement is not
   readable, so identity, lifecycle, and coverage context come first, then the
   measurement.
5. Dark mode was considered and cut. One committed light look keeps the
   contrast budget verifiable and matches the log-sheet register. Colors are
   painted explicitly, so the page does not inherit a host theme.
