/**
 * SSRF-validated raw TLS connect for non-HTTP rails (IMAP/SMTP). Same rules
 * as the egress proxy: public-IP-only resolution, connection pinned to a
 * validated address, hard connect timeout. Plaintext variants do not exist —
 * these rails are TLS-only.
 */
import { lookup as nodeLookup } from 'node:dns/promises';
import tls from 'node:tls';
import { isPublicIp } from '../egress/ip';
import { EgressDeniedError } from '../egress/safe-fetch';

export interface SafeSocketTestOverrides {
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  isPublicIp?: (addr: string) => boolean;
  /** test seam: plain TCP to an in-process server instead of TLS */
  plainTcp?: boolean;
}

const ALLOWED_PORTS = new Set([993, 465]); // IMAPS, SMTPS — implicit TLS only

export async function safeTlsConnect(
  host: string,
  port: number,
  timeoutMs = 15_000,
  overrides?: SafeSocketTestOverrides,
): Promise<tls.TLSSocket | import('node:net').Socket> {
  if (!ALLOWED_PORTS.has(port) && !overrides?.plainTcp) {
    throw new EgressDeniedError('port', `port ${port} is not an allowed TLS service port`);
  }
  const ipOk = overrides?.isPublicIp ?? isPublicIp;
  let pinned: { address: string; family: number };
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (!ipOk(host)) throw new EgressDeniedError('private-ip', `${host} is not a public address`);
    pinned = { address: host, family: host.includes(':') ? 6 : 4 };
  } else {
    const lookup =
      overrides?.lookup ??
      (async (h: string) => (await nodeLookup(h, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family })));
    let answers;
    try {
      answers = await lookup(host);
    } catch {
      throw new EgressDeniedError('dns', `cannot resolve ${host}`);
    }
    if (!answers.length) throw new EgressDeniedError('dns', `no addresses for ${host}`);
    for (const a of answers) {
      if (!ipOk(a.address)) throw new EgressDeniedError('private-ip', `${host} resolves to non-public ${a.address}`);
    }
    pinned = answers[0]!;
  }

  if (overrides?.plainTcp) {
    const net = await import('node:net');
    return await new Promise((resolve, reject) => {
      const sock = net.connect({ host: pinned.address, port, family: pinned.family }, () => resolve(sock));
      sock.setTimeout(timeoutMs, () => {
        sock.destroy();
        reject(new EgressDeniedError('timeout', 'socket timeout'));
      });
      sock.on('error', reject);
    });
  }

  return await new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host: pinned.address, port, servername: host, rejectUnauthorized: true },
      () => resolve(sock),
    );
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      reject(new EgressDeniedError('timeout', 'socket timeout'));
    });
    sock.on('error', reject);
  });
}
