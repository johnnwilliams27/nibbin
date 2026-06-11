/**
 * Layer 3b — NER. Production NER is the supervised Presidio sidecar talked to
 * by the Rust daemon; this module defines the client CONTRACT the pipeline
 * fail-closes on, plus a deterministic heuristic detector used by the corpus
 * and unit tests. The heuristic is NOT a fallback: when the real sidecar is
 * unavailable the pipeline halts (SPEC §5 layer 3, GOTCHAS "Redaction
 * fail-closed") — it never degrades to heuristics.
 */

export class NerUnavailableError extends Error {
  constructor(message = 'NER sidecar unavailable') {
    super(message);
    this.name = 'NerUnavailableError';
  }
}

export interface NerResult {
  redacted: string;
  rulesHit: string[];
}

export interface NerClient {
  /** Redact entities in `text`. MUST throw NerUnavailableError when the engine is down. */
  redact(text: string): Promise<NerResult>;
}

const STOPWORDS = new Set([
  // Capitalized UI/business words that start titles and labels; a name
  // candidate sequence must not be made of these alone.
  'invoice', 'account', 'send', 'sign', 'save', 'open', 'close', 'new', 'edit',
  'view', 'file', 'home', 'inbox', 'sent', 'draft', 'drafts', 'settings', 'help',
  'search', 'untitled', 'document', 'page', 'window', 'tab', 'the', 'a', 'an',
  'ship', 'bill', 'pay', 'from', 'to', 'for', 'with', 'and', 'or', 'of', 'in',
  'notes', 'phone', 'card', 'api', 'key', 'username', 'password', 'email',
]);

const NAME_TOKEN = /^[A-Z][a-z]+(?:[-'][A-Za-z0-9]+)*$/;

/**
 * Deterministic person-name detector: runs of ≥2 capitalized tokens that are
 * not UI stopwords become {PERSON}. Used as the corpus/test NER engine and as
 * defense-in-depth on review-UI display — never as a sidecar substitute.
 */
export class HeuristicNer implements NerClient {
  redact(text: string): Promise<NerResult> {
    const tokens = text.split(/(\s+)/);
    const isCandidate = (t: string) => NAME_TOKEN.test(t) && !STOPWORDS.has(t.toLowerCase());

    const out: string[] = [];
    let hit = false;
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i] ?? '';
      if (isCandidate(tok)) {
        // count the run of candidate tokens separated by single whitespace
        let j = i;
        let runLength = 1;
        while (j + 2 < tokens.length && /^\s+$/.test(tokens[j + 1] ?? '') && isCandidate(tokens[j + 2] ?? '')) {
          j += 2;
          runLength += 1;
        }
        if (runLength >= 2) {
          out.push('{PERSON}');
          hit = true;
          i = j + 1;
          continue;
        }
      }
      out.push(tok);
      i += 1;
    }
    return Promise.resolve({ redacted: out.join(''), rulesHit: hit ? ['PERSON'] : [] });
  }
}

/** Test/ops double for a dead sidecar: always throws NerUnavailableError. */
export class DownNer implements NerClient {
  redact(): Promise<NerResult> {
    return Promise.reject(new NerUnavailableError());
  }
}
