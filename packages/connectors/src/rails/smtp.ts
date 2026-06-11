/**
 * SMTP send rail [G] — the write half of imap-smtp. SMTPS (:465, implicit
 * TLS) over the SSRF-validated socket. Send paths unlock per-Nibbin at
 * adoption (C8) and every send passes the velocity caps (RISKS §2) — the
 * caller provides the limiter decision context exactly like the [H] clients.
 */
import { getConnector } from '../registry/registry';
import { SendVelocityLimiter } from '../send-velocity';
import { safeTlsConnect, type SafeSocketTestOverrides } from './safe-socket';

export interface SmtpConfig {
  host: string;
  port?: number; // 465
  username: string;
  password: string;
}

export interface OutboundEmail {
  from: string;
  to: string[];
  /** complete RFC 5322 message (headers + body) */
  rfc822: string;
}

type Socket = import('node:net').Socket;

function assertNoCrlf(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`CR/LF not allowed in ${what}`);
}

export class SmtpRailClient {
  constructor(
    private readonly config: SmtpConfig,
    private readonly overrides?: SafeSocketTestOverrides,
  ) {}

  /**
   * Send one message. Velocity-capped per account; the M4 runtime adds Agent
   * School stage gating on top.
   */
  async send(
    email: OutboundEmail,
    accountId: string,
    limiter: SendVelocityLimiter,
    accountCreatedAtMs: number,
  ): Promise<void> {
    const descriptor = getConnector('imap-smtp');
    const decision = await limiter.checkAndConsume(accountId, descriptor, accountCreatedAtMs);
    if (!decision.allowed) {
      throw new Error(`send blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`);
    }
    assertNoCrlf(email.from, 'from address');
    for (const rcpt of email.to) assertNoCrlf(rcpt, 'recipient address');

    const socket = (await safeTlsConnect(this.config.host, this.config.port ?? 465, 15_000, this.overrides)) as Socket;
    const read = makeLineReader(socket);
    const expect = async (codes: number[]): Promise<string> => {
      const line = await read();
      const code = Number(line.slice(0, 3));
      if (!codes.includes(code)) {
        socket.destroy();
        throw new Error(`smtp failure: ${line.slice(0, 80)}`);
      }
      return line;
    };
    const write = (s: string) => socket.write(s + '\r\n');

    try {
      await expect([220]);
      write('EHLO nibbin.local');
      await expect([250]);
      const plain = Buffer.from(`\0${this.config.username}\0${this.config.password}`, 'utf8').toString('base64');
      write(`AUTH PLAIN ${plain}`);
      await expect([235]);
      write(`MAIL FROM:<${email.from}>`);
      await expect([250]);
      for (const rcpt of email.to) {
        write(`RCPT TO:<${rcpt}>`);
        await expect([250, 251]);
      }
      write('DATA');
      await expect([354]);
      // dot-stuffing per RFC 5321 §4.5.2
      const stuffed = email.rfc822.replace(/\r\n\./g, '\r\n..');
      socket.write(stuffed.endsWith('\r\n') ? stuffed : stuffed + '\r\n');
      write('.');
      await expect([250]);
      write('QUIT');
    } finally {
      socket.destroy();
    }
  }
}

/** Multi-line-aware SMTP reply reader (collects until the final `250 ` line). */
function makeLineReader(socket: Socket): () => Promise<string> {
  let buffer = '';
  const pending: Array<{ resolve: (s: string) => void; reject: (e: Error) => void }> = [];
  const complete: string[] = [];

  const pump = () => {
    let eol;
    while ((eol = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      // continuation lines look like "250-..."; the last is "250 ..."
      if (/^\d{3}-/.test(line)) continue;
      complete.push(line);
    }
    while (complete.length && pending.length) {
      pending.shift()!.resolve(complete.shift()!);
    }
  };
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 64 * 1024) {
      socket.destroy();
      for (const p of pending.splice(0)) p.reject(new Error('smtp reply too large'));
      return;
    }
    pump();
  });
  socket.on('error', (e) => {
    for (const p of pending.splice(0)) p.reject(e);
  });
  socket.on('close', () => {
    for (const p of pending.splice(0)) p.reject(new Error('smtp connection closed'));
  });

  return () =>
    new Promise<string>((resolve, reject) => {
      pending.push({ resolve, reject });
      pump();
    });
}
