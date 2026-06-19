/**
 * The `computer_use` capability surface (design §4 / §4A / R9) — the browser /
 * computer-use tool family the Planner (mode C) may use, under the EXISTING
 * safety model. This is NOT a new loop: it adds a bounded tool family to the
 * Planner's validated surface (planner.ts), gated by the same walls.
 *
 * Shape (design §4 "Computer-use layer (C)"): a UNIFIED `target` that resolves
 * to EITHER a CSS selector OR coordinates, with screenshot+OCR as the universal
 * fallback; verbs navigate / click / type / extract / scroll / screenshot,
 * running in the `computer_use` weight class (10×, packages/shared credits).
 *
 * Safety thesis (load-bearing — mirrors the rest of the runtime):
 *  - The LLM picks a VERB + a bounded `target` spec only. There is no
 *    arbitrary-JS / `eval` verb — the surface is closed.
 *  - `navigate`/`extract`/`screenshot` are READ-class: their results are
 *    QUARANTINED (a page is data, never instructions) — handled in the planner
 *    harness exactly like web.fetch.
 *  - `click`/`type` are WRITE-class: they route through the runner approval gate
 *    as drafts-for-approval (a `DraftStep` through dispatchStep's School gate),
 *    so nothing acts on a page without the human's approval.
 *  - `navigate` URLs go through the SAME egress/SSRF guard as `web.fetch`
 *    (safeFetch host validation: reject private/loopback/metadata IPs); the
 *    driver itself never reaches a private target.
 *  - `validatePick` (validate.ts) re-validates verb ∈ surface + the target
 *    schema fail-closed on every pick; bounded by the computer_use ceilings +
 *    the loop kills (maxIterations / repetition / no-progress).
 *
 * The driver is an INTERFACE with a mock/in-memory adapter (tests) and a
 * Playwright-backed adapter behind an env flag (apps/web). The runtime package
 * stays pure: a real browser is never launched here.
 */
import { quarantine, type QuarantinedContent } from '@nibbin/connectors';

/* ── The unified target (design R9: selector | coords, OCR fallback) ─────────── */

/**
 * A bounded element target. EITHER a CSS selector OR (x,y) coordinates — never
 * both, never neither. `text` is an OPTIONAL accessibility/OCR hint the driver
 * may use to disambiguate (the universal fallback when neither selector nor
 * coords resolve). It is a BOUNDED spec the LLM fills, not arbitrary code.
 */
export interface BrowserTarget {
  selector?: string;
  x?: number;
  y?: number;
  /** Optional visible-text / a11y hint (the OCR fallback disambiguator). */
  text?: string;
}

/** The closed verb set. No `eval`/`script`/arbitrary-JS verb exists by design. */
export const COMPUTER_USE_VERBS = ['navigate', 'click', 'type', 'extract', 'scroll', 'screenshot'] as const;
export type ComputerUseVerb = (typeof COMPUTER_USE_VERBS)[number];

/**
 * Conservative ceilings for a SUPERVISED computer_use (browser) run (design
 * §351: "frontier/computer_use ceiling values (TBD in schema — must be set
 * during build)"). A computer_use run is heavier per action (10× weight) and
 * inherently supervised, so it is bounded TIGHTER than a frontier plan:
 *  - maxIterations 20: fewer ReAct turns than a frontier plan (30) — a browser
 *    task is mostly navigate→read→one-write, not deep reasoning.
 *  - maxSteps 40: each iteration may yield a couple of gated ProgramSteps.
 *  - maxTokens 12_000: page content is bulky; cap below the frontier 20k.
 *  - maxWallClockMs 90s: a browser action set is slower than an API call but a
 *    supervised run must not hang.
 * These are the canonical values the server (apps/web) re-stamps onto a
 * computer_use plan, and the Planner validator bounds against
 * MAX_COMPUTER_USE_* (validate.ts) so a crafted plan can't widen them.
 */
export const COMPUTER_USE_CEILINGS = {
  maxIterations: 20,
  maxSteps: 40,
  maxTokens: 12_000,
  maxWallClockMs: 90_000,
} as const;

/** The capability id for a verb (`computer_use.<verb>`). */
export function computerUseCapabilityId(verb: ComputerUseVerb): string {
  return `computer_use.${verb}`;
}

/* ── The driver interface (the verbs over a target) ──────────────────────────── */

/**
 * What a verb returns to the harness. READ verbs return quarantined page
 * content (`content`); WRITE verbs return a human-readable summary of the
 * action they WOULD take (`summary`) plus the bounded args the executor would
 * replay on approval — the driver NEVER auto-commits a write.
 */
export interface BrowserReadResult {
  kind: 'read';
  /** Quarantined page text / screenshot description — data, never instructions. */
  content: QuarantinedContent;
}

export interface BrowserDraftResult {
  kind: 'draft';
  /** Human-readable "what this would do" for the approval card. */
  summary: string;
}

export type BrowserVerbResult = BrowserReadResult | BrowserDraftResult;

/**
 * The browser/computer-use driver — the verbs over a `target`. Injected into
 * the Planner harness (like `utilities`). The mock driver (below) is used in
 * tests; the Playwright adapter (apps/web, env-flagged) is the real one.
 *
 * READ verbs (`navigate`/`extract`/`screenshot`/`scroll`) return quarantined
 * content. WRITE verbs (`click`/`type`) describe the action — they are NEVER
 * committed by the driver; the harness pauses them for approval and replays the
 * verb on `execute` only after the human approves.
 */
export interface BrowserDriver {
  /** Load a URL. The harness has ALREADY SSRF-validated the url (assertSafeNavigateUrl). */
  navigate(url: string): Promise<BrowserReadResult>;
  /** Read text/structure at/around a target (or the whole page if no target). */
  extract(target?: BrowserTarget): Promise<BrowserReadResult>;
  /** A screenshot, returned as a quarantined textual description (OCR/a11y). */
  screenshot(target?: BrowserTarget): Promise<BrowserReadResult>;
  /** Scroll the page/element (read-class — moves the viewport, commits nothing). */
  scroll(target?: BrowserTarget): Promise<BrowserReadResult>;
  /** Describe a click WITHOUT performing it (draft-for-approval). */
  click(target: BrowserTarget): Promise<BrowserDraftResult>;
  /** Describe typing `value` into `target` WITHOUT performing it (draft-for-approval). */
  type(target: BrowserTarget, value: string): Promise<BrowserDraftResult>;
  /** Commit an already-APPROVED write verb (click/type). Called by the executor
   *  on approval — never by the picker, never speculatively. */
  commit(verb: 'click' | 'type', target: BrowserTarget, value?: string): Promise<void>;
}

/* ── SSRF guard for navigate (reuse web.fetch's host validation, design) ─────── */

/**
 * The LITERAL-host pre-filter for `navigate`, mirroring web.fetch's
 * `isPrivateHost` (apps/web/lib/planner/websearch.ts): reject obviously-internal
 * targets (localhost/.local/.internal and any literal private/loopback/metadata
 * IP) before the driver ever touches the URL. The FULL rebind defense (resolve
 * every DNS answer + pin the connect) lives in the apps/web Playwright adapter,
 * which routes navigation egress through the same safeFetch-class guard
 * web.fetch uses. We accept an injected `isPublicIp` so this stays pure (no
 * dependency direction surprise) — apps/web passes the connectors predicate.
 *
 * Throws on an unsafe URL so a navigate pick fails CLOSED (never silently
 * reaches a private host).
 */
export function assertSafeNavigateUrl(
  url: unknown,
  isPublicIp: (addr: string) => boolean,
): asserts url is string {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('navigate requires a url');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('navigate url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('navigate url must be http(s)');
  }
  if (parsed.username || parsed.password) {
    throw new Error('navigate url must not embed credentials');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('navigate url host is not reachable (internal)');
  }
  const isLiteral = host.includes(':') || /^\d+(\.\d+){3}$/.test(host);
  if (isLiteral && !isPublicIp(host)) {
    throw new Error('navigate url host is not a public address');
  }
}

/* ── The mock / in-memory driver (tests + scripts) ───────────────────────────── */

/** A scripted page the mock driver serves (keyed by the last-navigated host or
 *  '*' for a default). */
export interface MockPage {
  /** Quarantine source label for reads on this page. */
  source?: string;
  /** Text `extract`/`screenshot`/`scroll`/`navigate` return (pre-quarantine). */
  content?: string;
}

/**
 * In-memory BrowserDriver — mirrors how the runtime tests mock `reader`/
 * `effects`. READ verbs return quarantined scripted content; WRITE verbs return
 * a summary and record the intended action in `commits` ONLY when `commit` is
 * called (so a test can assert nothing was committed without approval).
 */
export class MockBrowserDriver implements BrowserDriver {
  /** Every committed write, in order — a test asserts this is empty pre-approval. */
  readonly commits: { verb: 'click' | 'type'; target: BrowserTarget; value?: string }[] = [];
  private currentSource = 'browser:blank';

  constructor(private readonly page: MockPage = {}) {}

  private read(suffix: string): BrowserReadResult {
    const body = this.page.content ?? '(empty page)';
    const source = this.page.source ?? this.currentSource;
    return { kind: 'read', content: quarantine(body, `${source}:${suffix}`) };
  }

  async navigate(url: string): Promise<BrowserReadResult> {
    try {
      this.currentSource = `browser:${new URL(url).host}`;
    } catch {
      this.currentSource = 'browser:nav';
    }
    return this.read('navigate');
  }
  async extract(target?: BrowserTarget): Promise<BrowserReadResult> {
    return this.read(target?.selector ? `extract:${target.selector}` : 'extract');
  }
  async screenshot(): Promise<BrowserReadResult> {
    return this.read('screenshot');
  }
  async scroll(): Promise<BrowserReadResult> {
    return this.read('scroll');
  }
  async click(target: BrowserTarget): Promise<BrowserDraftResult> {
    return { kind: 'draft', summary: `click ${describeTarget(target)}` };
  }
  async type(target: BrowserTarget, value: string): Promise<BrowserDraftResult> {
    return { kind: 'draft', summary: `type ${JSON.stringify(value)} into ${describeTarget(target)}` };
  }
  async commit(verb: 'click' | 'type', target: BrowserTarget, value?: string): Promise<void> {
    this.commits.push({ verb, target, value });
  }
}

/** A short human-readable target label for approval cards / summaries. */
export function describeTarget(t: BrowserTarget): string {
  if (t.selector) return `selector "${t.selector}"`;
  if (typeof t.x === 'number' && typeof t.y === 'number') return `coordinates (${t.x}, ${t.y})`;
  if (t.text) return `element matching "${t.text}"`;
  return 'the page';
}

/* ── Fail-closed target + verb-arg validation (the schema validatePick runs) ─── */

/** A bounded selector: no leading scheme, length-capped, printable. A selector
 *  is never executed as code, but we still cap it so a hostile pick can't bloat
 *  the transcript or the approval card. */
const MAX_SELECTOR_CHARS = 512;
/** A typed value cap (mirrors EFFECT_ARG_MAX_CHARS in the interpreter — a write
 *  arg can never exceed one header-line's worth of attacker-controlled text). */
const MAX_TYPE_VALUE_CHARS = 998;

/** True for any registered computer_use verb. */
export function isComputerUseVerb(verb: unknown): verb is ComputerUseVerb {
  return typeof verb === 'string' && (COMPUTER_USE_VERBS as readonly string[]).includes(verb);
}

/**
 * Validate + normalize a `target` spec fail-closed. A target is valid iff it
 * carries EXACTLY ONE locator (selector OR a complete x/y coordinate pair); an
 * optional `text` hint is allowed alongside. Unknown keys, partial coordinates,
 * both-selector-and-coords, or neither all throw. Returns the cleaned target.
 */
export function validateTarget(raw: unknown): BrowserTarget {
  if (raw === null || typeof raw !== 'object') throw new Error('target must be an object');
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!['selector', 'x', 'y', 'text'].includes(key)) {
      throw new Error(`target has unknown key "${key}"`);
    }
  }
  const hasSelector = Object.hasOwn(obj, 'selector') && obj.selector !== undefined && obj.selector !== null;
  const hasX = Object.hasOwn(obj, 'x') && obj.x !== undefined && obj.x !== null;
  const hasY = Object.hasOwn(obj, 'y') && obj.y !== undefined && obj.y !== null;

  if (hasSelector && (hasX || hasY)) throw new Error('target must have a selector OR coordinates, not both');
  if (!hasSelector && !(hasX && hasY)) throw new Error('target needs a selector or a complete (x, y) coordinate pair');
  if ((hasX && !hasY) || (hasY && !hasX)) throw new Error('target coordinates need both x and y');

  const out: BrowserTarget = {};
  if (hasSelector) {
    if (typeof obj.selector !== 'string' || obj.selector.trim() === '') throw new Error('target selector must be a non-empty string');
    if (obj.selector.length > MAX_SELECTOR_CHARS) throw new Error(`target selector exceeds ${MAX_SELECTOR_CHARS} chars`);
    if (obj.selector.includes('://')) throw new Error('target selector must not contain a URL scheme');
    out.selector = obj.selector;
  } else {
    if (typeof obj.x !== 'number' || !Number.isFinite(obj.x) || obj.x < 0) throw new Error('target x must be a non-negative finite number');
    if (typeof obj.y !== 'number' || !Number.isFinite(obj.y) || obj.y < 0) throw new Error('target y must be a non-negative finite number');
    out.x = obj.x;
    out.y = obj.y;
  }
  if (Object.hasOwn(obj, 'text') && obj.text !== undefined && obj.text !== null) {
    if (typeof obj.text !== 'string') throw new Error('target text hint must be a string');
    if (obj.text.length > MAX_SELECTOR_CHARS) throw new Error(`target text hint exceeds ${MAX_SELECTOR_CHARS} chars`);
    out.text = obj.text;
  }
  return out;
}

/** A validated computer_use pick: the resolved verb + (where applicable) target +
 *  value/url. Returned by validateComputerUseArgs so the harness reuses it. */
export type ComputerUseArgs =
  | { verb: 'navigate'; url: string }
  | { verb: 'extract' | 'screenshot' | 'scroll'; target?: BrowserTarget }
  | { verb: 'click'; target: BrowserTarget }
  | { verb: 'type'; target: BrowserTarget; value: string };

/**
 * Fail-closed validation of a computer_use verb's args (design §5 — verb ∈
 * surface + target schema). The `navigate` url SSRF check is applied SEPARATELY
 * by the caller (it needs the injected isPublicIp); here we validate shape only.
 * Throws on any mismatch so validatePick rejects the pick.
 */
export function validateComputerUseArgs(verb: ComputerUseVerb, args: Record<string, unknown>): ComputerUseArgs {
  switch (verb) {
    case 'navigate': {
      if (typeof args.url !== 'string' || args.url.trim() === '') throw new Error('navigate requires a url string');
      return { verb, url: args.url };
    }
    case 'extract':
    case 'screenshot':
    case 'scroll': {
      // target is OPTIONAL for read verbs (whole-page read). If present, validate.
      const target = args.target === undefined ? undefined : validateTarget(args.target);
      return { verb, target };
    }
    case 'click': {
      return { verb, target: validateTarget(args.target) };
    }
    case 'type': {
      const target = validateTarget(args.target);
      if (typeof args.value !== 'string') throw new Error('type requires a string value');
      if (args.value.length > MAX_TYPE_VALUE_CHARS) throw new Error(`type value exceeds ${MAX_TYPE_VALUE_CHARS} chars`);
      return { verb, target, value: args.value };
    }
  }
}
