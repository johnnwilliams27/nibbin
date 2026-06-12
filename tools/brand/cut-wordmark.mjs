// Wordmark v1.0 production cutter.
// Source of truth: reference/nibbin-logo-guide.html (Plates L1/L3/L9) — values are frozen.
// Outlines "nibb" + "n" from Bricolage Grotesque (wght 800, opsz 56, letter-spacing −1.5
// at the 56px master), splices the hand-drawn sprout glyph verbatim, and cuts the full
// asset suite into packages/shared/brand/.
//
// Usage:  cd tools/brand && npm install && npm run cut
// The font is fetched from the Google Fonts repo on first run (cached beside this script).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'packages', 'shared', 'brand');
const VERIFY = process.env.VERIFY_DIR || '';
const FONT_FILE = path.join(HERE, 'BricolageGrotesque-VF.ttf');
const FONT_URL =
  'https://github.com/google/fonts/raw/main/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf';

// ---- frozen master values (Plate L1; master = 56px, viewBox baseline y=70) ----
const FS = 56;
const LS = -1.5; // letter-spacing at the 56px master, applied per glyph advance
const BASELINE = 70;
const X0 = 8;
const GLYPH_CELL = 17; // sprout cell width
const KERN = { light: { A: 4, B: -12 }, dusk: { A: 5, B: -11 } };

// Sprout glyph paths — hand-drawn geometry, copied verbatim from Plate L1. Never redrawn.
const SPROUT = {
  light: {
    stem: { d: 'M5.4 70 C6 58 7.1 47 7.7 36.5 L10 36.5 C10.8 47 11.8 58 12.4 70 Z', fill: '#44601F' },
    leafL: { d: 'M8.6 37.5 C2.5 38 -4.2 35.5 -6.5 30 C-0.5 27.2 6.4 30.8 8.6 37.5 Z', fill: '#5B7C2E', stroke: '#44601F', sw: 1.4 },
    leafR: { d: 'M9 37.5 C15 36.6 21.5 33.6 23.5 28.6 C17.3 26.2 10.6 29.8 9 37.5 Z', fill: '#7FAF45', stroke: '#44601F', sw: 1.4 },
    letters: '#23291A',
    overshoot: false,
  },
  dusk: {
    stem: { d: 'M5.4 71.2 C6 58.8 7.1 47 7.7 36.5 L10 36.5 C10.8 47 11.8 58.8 12.4 71.2 Z', fill: '#9CC25B' },
    leafL: { d: 'M8.6 37.5 C2.5 38 -4.2 35.5 -6.5 30 C-0.5 27.2 6.4 30.8 8.6 37.5 Z', fill: '#9CC25B', stroke: '#5F8F33', sw: 1.2 },
    leafR: { d: 'M9 37.5 C15 36.6 21.5 33.6 23.5 28.6 C17.3 26.2 10.6 29.8 9 37.5 Z', fill: '#7FAF45', stroke: '#5F8F33', sw: 1.2 },
    letters: '#E8ECDD',
    overshoot: true,
  },
};

// Sprout mark — Plate L3 light artwork, verbatim (the wordmark's glyph at large scale).
const MARK_VIEWBOX = '0 0 72 72';
const MARK_LIGHT = [
  '<path d="M32 66 C33 52 35 40 36 30 L40 30 C41.4 40 43.4 52 44.6 66 Z" fill="#44601F"/>',
  '<path d="M37.4 31 C26 32 14 27 11 16.5 C22 14 33 20.5 37.4 31 Z" fill="#5B7C2E" stroke="#44601F" stroke-width="2.2" stroke-linejoin="round"/>',
  '<path d="M39 31 C49.5 28.5 57.5 20 59.5 10 C48.5 8.5 41 18 39 31 Z" fill="#7FAF45" stroke="#44601F" stroke-width="2.2" stroke-linejoin="round"/>',
].join('\n  ');

const PAPER = '#F5F6F2';
const UNDERSTORY = '#EAEDE3';

// ---- font ----
async function ensureFont() {
  if (fs.existsSync(FONT_FILE)) return;
  console.log('fetching Bricolage Grotesque variable font…');
  const res = await fetch(FONT_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`font download failed: ${res.status}`);
  fs.writeFileSync(FONT_FILE, Buffer.from(await res.arrayBuffer()));
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

// Convert a fontkit glyph path (font units, y-up) to an SVG d string at pen position.
function glyphToD(glyph, penX, scale) {
  const tx = (x) => r2(penX + x * scale);
  const ty = (y) => r2(BASELINE - y * scale);
  let d = '';
  for (const c of glyph.path.commands) {
    const a = c.args;
    switch (c.command) {
      case 'moveTo': d += `M${tx(a[0])} ${ty(a[1])}`; break;
      case 'lineTo': d += `L${tx(a[0])} ${ty(a[1])}`; break;
      case 'quadraticCurveTo': d += `Q${tx(a[0])} ${ty(a[1])} ${tx(a[2])} ${ty(a[3])}`; break;
      case 'bezierCurveTo': d += `C${tx(a[0])} ${ty(a[1])} ${tx(a[2])} ${ty(a[3])} ${tx(a[4])} ${ty(a[5])}`; break;
      case 'closePath': d += 'Z'; break;
    }
  }
  return d;
}

// Layout a run with kern feature + letter-spacing after every glyph (matches the
// browser measurement the kerns were tuned against). Returns paths + total advance.
function layoutRun(font, text, startX, scale) {
  const run = font.layout(text, ['kern', 'liga']);
  let pen = startX;
  let d = '';
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i];
    const pos = run.positions[i];
    const gx = pen + pos.xOffset * scale;
    d += glyphToD(g, gx, scale);
    const bb = g.bbox;
    if (bb.minX !== Infinity) {
      minX = Math.min(minX, gx + bb.minX * scale);
      maxX = Math.max(maxX, gx + bb.maxX * scale);
      minY = Math.min(minY, BASELINE - bb.maxY * scale);
    }
    pen += pos.xAdvance * scale + LS;
  }
  return { d, advance: pen - startX, minX, maxX, minY };
}

// Sample the sprout's bezier paths (plus stroke half-width) for the ink bbox.
function sproutBBox(variant, dx) {
  const pts = [];
  const collect = (dStr, halfStroke) => {
    // crude but exact-enough: sample every numeric pair along each curve's hull
    const nums = dStr.match(/-?\d+\.?\d*/g).map(Number);
    for (let i = 0; i < nums.length - 1; i += 2) {
      pts.push({ x: nums[i] + dx, y: nums[i + 1], h: halfStroke });
    }
  };
  collect(variant.stem.d, 0);
  collect(variant.leafL.d, variant.leafL.sw / 2);
  collect(variant.leafR.d, variant.leafR.sw / 2);
  return {
    minX: Math.min(...pts.map((p) => p.x - p.h)),
    maxX: Math.max(...pts.map((p) => p.x + p.h)),
    minY: Math.min(...pts.map((p) => p.y - p.h)),
    maxY: Math.max(...pts.map((p) => p.y + p.h)),
  };
}

function sproutGroup(variant, dx, mono) {
  const p = (el, extra) =>
    mono
      ? `<path d="${el.d}" fill="${mono}"/>`
      : `<path d="${el.d}" fill="${el.fill}"${extra ? ` stroke="${el.stroke}" stroke-width="${el.sw}" stroke-linejoin="round"` : ''}/>`;
  return [
    `<g transform="translate(${r2(dx)} 0)">`,
    `  ${p(variant.stem, false)}`,
    `  ${p(variant.leafL, true)}`,
    `  ${p(variant.leafR, true)}`,
    `</g>`,
  ].join('\n  ');
}

function buildWordmark(font, scale, ground, mono) {
  const v = SPROUT[ground];
  const k = KERN[ground];
  const r1 = layoutRun(font, 'nibb', X0, scale);
  const gx = X0 + r1.advance + 0.5 + k.A; // sprout glyph origin (art drawn around local x≈8.5)
  const dx = gx - 8;
  const r2x = gx + GLYPH_CELL + 0.5 + k.B;
  const r2run = layoutRun(font, 'n', r2x, scale);

  const sb = sproutBBox(v, dx);
  const inkMinX = Math.min(r1.minX, sb.minX);
  const inkMaxX = Math.max(r2run.maxX, sb.maxX);
  const inkMinY = Math.min(r1.minY, r2run.minY, sb.minY);
  const inkMaxY = Math.max(BASELINE, sb.maxY); // letters sit on the baseline; dusk stem overshoots
  const bleed = 0.6;
  const vb = `${r2(inkMinX - bleed)} ${r2(inkMinY - bleed)} ${r2(inkMaxX - inkMinX + 2 * bleed)} ${r2(inkMaxY - inkMinY + 2 * bleed)}`;

  const letterFill = mono || v.letters;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="nibbin">`,
    `  <!-- nibbin wordmark v1.0 (${mono ? (ground === 'light' ? 'mono' : 'mono reverse') : ground} artwork) — outlined paths, cut from reference/nibbin-logo-guide.html frozen values. Do not edit by hand; re-cut via tools/brand. -->`,
    `  <path d="${r1.d}" fill="${letterFill}"/>`,
    `  ${sproutGroup(v, dx, mono)}`,
    `  <path d="${r2run.d}" fill="${letterFill}"/>`,
    `</svg>`,
    ``,
  ].join('\n');

  return { svg, vb, diag: { advance: r1.advance, gx, r2x, inkMinX, inkMaxX, inkMinY, inkMaxY } };
}

function markSvg() {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" role="img" aria-label="nibbin">`,
    `  <!-- nibbin sprout mark v1.0 — the wordmark's living glyph (Plate L3), never a separate drawing. -->`,
    `  ${MARK_LIGHT}`,
    `</svg>`,
    ``,
  ].join('\n');
}

// Wrap an SVG body in a sized tile for icon rasterization.
function tileSvg(size, bg, markSize) {
  const off = (size - markSize) / 2;
  const s = markSize / 72;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <rect width="${size}" height="${size}" fill="${bg}"/>`,
    `  <g transform="translate(${r2(off)} ${r2(off)}) scale(${r2(s)})">`,
    `  ${MARK_LIGHT}`,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}

async function rasterizeSvg(svgString, width, height, file) {
  const buf = await sharp(Buffer.from(svgString), { density: 300 })
    .resize(width, height)
    .png()
    .toBuffer();
  fs.writeFileSync(file, buf);
  return buf;
}

// Render an SVG (with viewBox) at an exact pixel height, transparent ground.
async function renderAtHeight(svgString, heightPx, file) {
  const vb = svgString.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const w = Math.round((vb[2] / vb[3]) * heightPx);
  const sized = svgString.replace('<svg ', `<svg width="${w}" height="${heightPx}" `);
  return rasterizeSvg(sized, w, heightPx, file);
}

async function main() {
  await ensureFont();
  const vf = fontkit.openSync(FONT_FILE);
  const font = vf.getVariation({ wght: 800, opsz: FS, wdth: 100 });
  const scale = FS / font.unitsPerEm;
  console.log(`font: ${vf.fullName} upem=${font.unitsPerEm} scale=${r2(scale)}`);

  // sanity bound from the guide's own preview script: per-char advance in [0.2, 0.85] × fs
  const probe = layoutRun(font, 'nibb', 0, scale);
  const perChar = probe.advance / 4;
  if (perChar < FS * 0.2 || perChar > FS * 0.85) {
    throw new Error(`advance sanity check failed: perChar=${r2(perChar)}`);
  }
  console.log(`advance("nibb") incl. letter-spacing = ${r2(probe.advance)} (perChar ${r2(perChar)})`);

  fs.mkdirSync(OUT, { recursive: true });

  const light = buildWordmark(font, scale, 'light', null);
  const dusk = buildWordmark(font, scale, 'dusk', null);
  const mono = buildWordmark(font, scale, 'light', '#23291A');
  const monoRev = buildWordmark(font, scale, 'dusk', '#E8ECDD');
  console.log('light:', JSON.stringify(light.diag));
  console.log('dusk :', JSON.stringify(dusk.diag));

  const svgs = {
    'nibbin-wordmark-light.svg': light.svg,
    'nibbin-wordmark-dusk.svg': dusk.svg,
    'nibbin-wordmark-mono.svg': mono.svg,
    'nibbin-wordmark-mono-reverse.svg': monoRev.svg,
    'nibbin-mark.svg': markSvg(),
  };
  for (const [name, svg] of Object.entries(svgs)) {
    if (/<text|font-family|@font-face|fonts\.googleapis/.test(svg)) {
      throw new Error(`${name} contains text/font references — refusing to write`);
    }
    fs.writeFileSync(path.join(OUT, name), svg);
    console.log('wrote', name);
  }

  // favicons — below 16px wordmark floor, so always the mark (Plate L5)
  const mark = markSvg();
  const fav16 = await renderAtHeight(mark, 16, path.join(OUT, 'favicon-16.png'));
  const fav32 = await renderAtHeight(mark, 32, path.join(OUT, 'favicon-32.png'));
  fs.writeFileSync(path.join(OUT, 'favicon.ico'), await pngToIco([fav16, fav32]));
  console.log('wrote favicon-16.png favicon-32.png favicon.ico');

  // app icons — mark on Understory tile; maskable keeps the mark inside the 80% safe zone
  await rasterizeSvg(tileSvg(512, UNDERSTORY, 320), 512, 512, path.join(OUT, 'app-icon-512.png'));
  await rasterizeSvg(tileSvg(1024, UNDERSTORY, 640), 1024, 1024, path.join(OUT, 'app-icon-1024.png'));
  await rasterizeSvg(tileSvg(512, UNDERSTORY, 280), 512, 512, path.join(OUT, 'app-icon-maskable-512.png'));
  console.log('wrote app icons');

  // og image — light wordmark centered on Paper, ≥1Λ clear space (Λ = 30 master units)
  {
    const vb = light.vb.split(' ').map(Number);
    const H = 180;
    const s = H / vb[3];
    const W = Math.round(vb[2] * s);
    const lambda = 30 * s;
    const clearX = (1200 - W) / 2;
    const clearY = (630 - H) / 2;
    if (clearX < lambda || clearY < lambda) throw new Error('og-image clear space < 1Λ');
    const body = light.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const og = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
      `  <rect width="1200" height="630" fill="${PAPER}"/>`,
      `  <g transform="translate(${r2(clearX)} ${r2(clearY)}) scale(${r2(s)}) translate(${r2(-vb[0])} ${r2(-vb[1])})">`,
      body,
      `  </g>`,
      `</svg>`,
    ].join('\n');
    await rasterizeSvg(og, 1200, 630, path.join(OUT, 'og-image.png'));
    console.log(`wrote og-image.png (wordmark ${W}×${H}, clear ${r2(clearX)}/${r2(clearY)}, 1Λ=${r2(lambda)})`);
  }

  // verification renders
  if (VERIFY) {
    fs.mkdirSync(VERIFY, { recursive: true });
    for (const [name, svg] of Object.entries(svgs)) {
      // dusk artwork verifies on its approved ground, not on transparent/white
      const onGround = /dusk|reverse/.test(name)
        ? svg.replace(/(viewBox="([^"]+)"[^>]*>)/, (m, tag, vb) => {
            const [x, y, w, h] = vb.split(' ');
            return `${tag}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#222B1B"/>`;
          })
        : svg;
      for (const h of [16, 32, 64, 256]) {
        await renderAtHeight(onGround, h, path.join(VERIFY, `${name.replace('.svg', '')}-h${h}.png`));
      }
    }
    console.log('verification renders in', VERIFY);
  }

  console.log('done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
