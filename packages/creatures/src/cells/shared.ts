/**
 * Shared scaffolding for the high-fidelity "ported cell" species (200×230).
 *
 * `cellDefs` holds the neutral, palette-independent gradients/filters every
 * ported cell relies on (eyes, cheeks, blur, egg/shell/stem/board). The helper
 * functions below bake the parts that are identical across species — the
 * graduation mortarboard (tassel-tagged), the shaded eyes, the coral blush, the
 * smile, the hatching eggshell, and the dormant egg ovoid — so each species
 * file only authors what makes it that species.
 *
 * Gradient/filter ids are suffixed with an m-prefixed uid (`const u = 'm' +
 * nextUid()`); the engine's determinism test normalizes `/m\d+/g`, so the
 * `m` prefix is REQUIRED.
 */
import { shade } from '../color';

/** Neutral, palette-independent defs shared by every ported cell. */
export function cellDefs(u: string): string {
  return `<defs>
    <filter id="bSm${u}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2"/></filter>
    <filter id="bMd${u}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
    <radialGradient id="eW${u}" cx="50%" cy="34%" r="72%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#E7EEDC"/></radialGradient>
    <radialGradient id="eP${u}" cx="42%" cy="35%" r="75%"><stop offset="0%" stop-color="#3B3930"/><stop offset="100%" stop-color="#191711"/></radialGradient>
    <radialGradient id="ck${u}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#E2603A" stop-opacity=".5"/><stop offset="100%" stop-color="#E2603A" stop-opacity="0"/></radialGradient>
    <radialGradient id="eggG${u}" cx="42%" cy="32%" r="80%"><stop offset="0%" stop-color="#FDF8EA"/><stop offset="100%" stop-color="#E2D4AF"/></radialGradient>
    <radialGradient id="shellG${u}" cx="42%" cy="34%" r="75%"><stop offset="0%" stop-color="#FDF8EA"/><stop offset="100%" stop-color="#EADCBA"/></radialGradient>
    <radialGradient id="stemG${u}" cx="42%" cy="34%" r="80%"><stop offset="0%" stop-color="#FCF3E1"/><stop offset="100%" stop-color="#E4CFAA"/></radialGradient>
    <linearGradient id="boardG${u}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="#3A4458"/><stop offset="100%" stop-color="#222A3A"/></linearGradient>
  </defs>`;
}

/** Star path centred at (cx,cy), radius r. */
export function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<path d="M${pts.join(' L')} Z" fill="${fill}" stroke="#B98F1F" stroke-width="1.2" stroke-linejoin="round"/>`;
}

/**
 * Palette-tinted body mass — radial light→mid→dark gradient with a matching
 * dark outline. `key` disambiguates the gradient id when a species draws more
 * than one tinted shape (e.g. Glim's head + abdomen) in a single render.
 * Emits shade(±28/−30/−45) only — never the feature-marker tints (45/30/50).
 */
export function tintedBody(
  u: string,
  key: string,
  d: string,
  color: string,
  opts: { sw?: number } = {},
): string {
  const sw = opts.sw ?? 2.2;
  const id = `b${key}${u}`;
  return `<defs><radialGradient id="${id}" cx="40%" cy="28%" r="86%"><stop offset="0%" stop-color="${shade(color, 28)}"/><stop offset="60%" stop-color="${color}"/><stop offset="100%" stop-color="${shade(color, -30)}"/></radialGradient></defs><path d="${d}" fill="url(#${id})" stroke="${shade(color, -45)}" stroke-width="${sw}"/>`;
}

/** Shaded eyes (graded white + pupils toed toward centre + catchlights). */
export function cellEyes(
  u: string,
  exL: number,
  exR: number,
  ey: number,
  stroke: string,
  opts: { rx?: number; ry?: number; pr?: number; hl?: number; sw?: number } = {},
): string {
  const rx = opts.rx ?? 12.5, ry = opts.ry ?? 14, pr = opts.pr ?? 7.5, hl = opts.hl ?? 2.7, sw = opts.sw ?? 1.7;
  const py = ey + 3;
  // class="blink" — the engine's creatureCss squishes the eye group on a slow
  // cycle (disabled under prefers-reduced-motion).
  return `<g class="blink"><ellipse cx="${exL}" cy="${ey}" rx="${rx}" ry="${ry}" fill="url(#eW${u})" stroke="${stroke}" stroke-width="${sw}"/><ellipse cx="${exR}" cy="${ey}" rx="${rx}" ry="${ry}" fill="url(#eW${u})" stroke="${stroke}" stroke-width="${sw}"/>
    <circle cx="${exL + 3}" cy="${py}" r="${pr}" fill="url(#eP${u})"/><circle cx="${exR - 3}" cy="${py}" r="${pr}" fill="url(#eP${u})"/>
    <circle cx="${exL - 1}" cy="${ey - 2}" r="${hl}" fill="#fff"/><circle cx="${exR - 1}" cy="${ey - 2}" r="${hl}" fill="#fff"/></g>`;
}

/** Coral blush (#E2603A via the ck gradient) on both cheeks. */
export function cellBlush(u: string, lx: number, rx: number, y: number, brx = 7.5, bry = 5): string {
  return `<ellipse cx="${lx}" cy="${y}" rx="${brx}" ry="${bry}" fill="url(#ck${u})"/><ellipse cx="${rx}" cy="${y}" rx="${brx}" ry="${bry}" fill="url(#ck${u})"/>`;
}

/** A small upturned smile centred at (cx,y), half-width w. */
export function cellSmile(cx: number, y: number, w: number, stroke: string): string {
  return `<path d="M${cx - w} ${y} Q${cx} ${y + w * 0.85} ${cx + w} ${y}" stroke="${stroke}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
}

/**
 * Graduation mortarboard, authored centred on its button at the origin and
 * placed at (cx,cy). The cord+ball are tagged `class="tassel"` — the engine
 * test requires every graduate to contain `tassel` and no student to.
 */
export function mortarboard(u: string, cx: number, cy: number, opts: { scale?: number; rot?: number } = {}): string {
  const scale = opts.scale ?? 1, rot = opts.rot ?? -5;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${scale})">
    <path d="M0 -3 L-22 8 L-22 12 C-18 17 18 17 22 12 L22 8 Z" fill="#1E2532"/>
    <path d="M-29 0 L0 -13 L29 0 L0 13 Z" fill="url(#boardG${u})" stroke="#161C28" stroke-width="1.4"/>
    <circle cx="0" cy="0" r="2.8" fill="#D9A21B"/>
    <g class="tassel" style="transform-origin:0px 0px"><path d="M0 0 L24 -2 L24 18" stroke="#D9A21B" stroke-width="1.7" fill="none"/><circle cx="24" cy="20" r="3.2" fill="#F6E08A" stroke="#B98F1F" stroke-width="1"/></g>
  </g>`;
}

/** The dormant egg ovoid + soft inner highlight (feature hint drawn by caller). */
export function eggBase(u: string): string {
  return `<path d="M100 78 C81 78 68 98 68 126 C68 154 82 176 100 176 C118 176 132 154 132 126 C132 98 119 78 100 78 Z" fill="url(#eggG${u})" stroke="#9C824E" stroke-width="2"/><ellipse cx="86" cy="138" rx="24" ry="28" fill="#FFFBEE" opacity=".5" filter="url(#bMd${u})"/>`;
}

/** The just-hatched jagged eggshell the student sits in. */
export function hatchShell(u: string): string {
  return `<path d="M52 156 L60 144 L70 156 L80 146 L90 158 L100 166 L110 158 L120 146 L130 156 L140 144 L148 156 C152 200 48 200 52 156 Z" fill="url(#shellG${u})" stroke="#C9B488" stroke-width="2" stroke-linejoin="round"/><path d="M60 154 C82 162 118 162 140 154" stroke="#FFFDF4" stroke-width="1.6" fill="none" opacity=".5"/><circle cx="72" cy="176" r="2.6" fill="#C9A86A" opacity=".5"/><circle cx="100" cy="186" r="3" fill="#C9A86A" opacity=".5"/><circle cx="126" cy="174" r="2.4" fill="#C9A86A" opacity=".5"/><circle cx="86" cy="182" r="2" fill="#C9A86A" opacity=".45"/>`;
}
