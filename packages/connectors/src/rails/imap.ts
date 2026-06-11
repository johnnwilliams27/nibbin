/**
 * IMAP rail [G] — the email long tail (SPEC §4.3).
 *
 * Read-only by construction: the mailbox is opened with EXAMINE (the IMAP
 * read-only open), so even a bug cannot flag, move, or delete mail — C8 at
 * the protocol layer. TLS-only (IMAPS :993) over the SSRF-validated socket.
 * Credentials live in the vault like every other connection (C9).
 */
import { quarantine, type QuarantinedContent } from '../quarantine';
import { safeTlsConnect, type SafeSocketTestOverrides } from './safe-socket';

export interface ImapConfig {
  host: string;
  port?: number; // 993
  username: string;
  password: string;
}

type Socket = import('node:net').Socket;

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Line/literal-aware reader: resolves when the tagged completion arrives. */
class ImapReader {
  private buffer = Buffer.alloc(0);
  private pendingLiteral = 0;
  private waiter?: { tag: string; resolve: (lines: string) => void; reject: (e: Error) => void; collected: Buffer[] };

  constructor(socket: Socket, private readonly onFatal: (e: Error) => void) {
    socket.on('data', (chunk: Buffer) => this.feed(chunk));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('imap connection closed')));
  }

  private fail(e: Error): void {
    this.waiter?.reject(e);
    this.waiter = undefined;
    this.onFatal(e);
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_RESPONSE_BYTES) {
      this.fail(new Error('imap response exceeded size limit'));
      return;
    }
    this.drain();
  }

  private drain(): void {
    while (true) {
      if (this.pendingLiteral > 0) {
        if (this.buffer.length < this.pendingLiteral) return;
        this.waiter?.collected.push(this.buffer.subarray(0, this.pendingLiteral));
        this.buffer = this.buffer.subarray(this.pendingLiteral);
        this.pendingLiteral = 0;
        continue;
      }
      const eol = this.buffer.indexOf('\r\n');
      if (eol === -1) return;
      const line = this.buffer.subarray(0, eol).toString('utf8');
      this.buffer = this.buffer.subarray(eol + 2);
      this.waiter?.collected.push(Buffer.from(line + '\r\n', 'utf8'));
      const literal = line.match(/\{(\d+)\}$/);
      if (literal) {
        this.pendingLiteral = Number(literal[1]);
        if (this.pendingLiteral > MAX_RESPONSE_BYTES) {
          this.fail(new Error('imap literal exceeds size limit'));
          return;
        }
        continue;
      }
      if (this.waiter && (line.startsWith(`${this.waiter.tag} `) || (this.waiter.tag === '*' && line.startsWith('* ')))) {
        const w = this.waiter;
        this.waiter = undefined;
        w.resolve(Buffer.concat(w.collected).toString('utf8'));
        return;
      }
    }
  }

  await(tag: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiter = { tag, resolve, reject, collected: [] };
      this.drain(); // greeting may already be buffered
    });
  }
}

/** Quote an IMAP string argument; rejects CR/LF injection outright. */
function imapQuote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('CR/LF not allowed in IMAP arguments');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export class ImapRailClient {
  private socket?: Socket;
  private reader?: ImapReader;
  private tagCounter = 0;

  constructor(
    private readonly config: ImapConfig,
    private readonly overrides?: SafeSocketTestOverrides,
  ) {}

  private async command(command: string): Promise<string> {
    if (!this.socket || !this.reader) throw new Error('not connected');
    const tag = `a${++this.tagCounter}`;
    const done = this.reader.await(tag);
    this.socket.write(`${tag} ${command}\r\n`);
    const response = await done;
    const status = response.trimEnd().split('\r\n').pop() ?? '';
    if (!status.startsWith(`${tag} OK`)) {
      // never echo the command — LOGIN carries the credential
      throw new Error(`imap command failed: ${status.replace(/^a\d+ /, '')}`);
    }
    return response;
  }

  async connect(): Promise<void> {
    this.socket = (await safeTlsConnect(this.config.host, this.config.port ?? 993, 15_000, this.overrides)) as Socket;
    this.reader = new ImapReader(this.socket, () => this.socket?.destroy());
    try {
      await this.reader.await('*'); // server greeting
      await this.command(`LOGIN ${imapQuote(this.config.username)} ${imapQuote(this.config.password)}`);
      // EXAMINE = read-only open; STORE/EXPUNGE are rejected by the server itself
      await this.command('EXAMINE INBOX');
    } catch (e) {
      this.socket.destroy();
      throw e;
    }
  }

  /** Message sequence numbers since the given date. */
  async searchSince(date: Date): Promise<number[]> {
    const day = date.getUTCDate();
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
    const response = await this.command(`SEARCH SINCE ${day}-${month}-${date.getUTCFullYear()}`);
    const line = response.split('\r\n').find((l) => l.startsWith('* SEARCH'));
    if (!line) return [];
    return line
      .slice('* SEARCH'.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  /** Headers only (BODY.PEEK leaves \Seen untouched). Quarantined. */
  async fetchHeaders(sequenceSet: string): Promise<QuarantinedContent> {
    if (!/^[\d,:*]+$/.test(sequenceSet)) throw new Error('invalid sequence set');
    const response = await this.command(
      `FETCH ${sequenceSet} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE IN-REPLY-TO LIST-UNSUBSCRIBE)])`,
    );
    return quarantine(response, `imap-smtp:${this.config.host}:headers`);
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT');
    } catch {
      // server may close before the tagged reply; that's fine
    }
    this.socket?.destroy();
  }
}
