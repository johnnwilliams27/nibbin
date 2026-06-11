/**
 * Public-IP classification for the deny-by-default egress proxy (SPEC §6.5,
 * §6.9; docs/RISKS.md §2 "Generic MCP / webhook rail = SSRF surface").
 *
 * Everything not provably public-unicast is denied: loopback, RFC1918,
 * link-local, CGNAT, multicast, reserved, documentation ranges — and their
 * IPv6 equivalents including v4-mapped/translated forms (an attacker who can
 * make us dial `::ffff:169.254.169.254` has reached the metadata service).
 */

/** Strict dotted-quad parse → 32-bit unsigned int, or null. */
export function parseIpv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // reject octal-looking forms ("010") — parsers disagree on them, and
    // parser disagreement is exactly how SSRF filters get bypassed
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

interface V4Range {
  base: number;
  maskBits: number;
}

function v4Range(cidr: string): V4Range {
  const [ip, bits] = cidr.split('/');
  const base = parseIpv4(ip!);
  if (base === null) throw new Error(`bad cidr ${cidr}`);
  return { base, maskBits: Number(bits) };
}

const BLOCKED_V4: V4Range[] = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // RFC1918
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local (cloud metadata lives here)
  '172.16.0.0/12', // RFC1918
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.88.99.0/24', // 6to4 relay anycast (deprecated)
  '192.168.0.0/16', // RFC1918
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved + broadcast
].map(v4Range);

function inV4Range(addr: number, range: V4Range): boolean {
  if (range.maskBits === 0) return true;
  const shift = 32 - range.maskBits;
  return addr >>> shift === range.base >>> shift;
}

export function isPublicIpv4(addr: string): boolean {
  const value = parseIpv4(addr);
  if (value === null) return false;
  return !BLOCKED_V4.some((r) => inV4Range(value, r));
}

/** Expand an IPv6 literal to 8 groups of 16-bit numbers, or null if invalid. */
export function parseIpv6(s: string): number[] | null {
  let input = s.trim().toLowerCase();
  // zone index (fe80::1%eth0) — never public, but parse cleanly
  const zone = input.indexOf('%');
  if (zone !== -1) input = input.slice(0, zone);
  if (input.includes(':::')) return null;

  // trailing dotted-quad (::ffff:127.0.0.1)
  let v4Tail: number[] | null = null;
  const lastColon = input.lastIndexOf(':');
  if (lastColon !== -1 && input.includes('.', lastColon)) {
    const v4 = parseIpv4(input.slice(lastColon + 1));
    if (v4 === null) return null;
    v4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    input = input.slice(0, lastColon + 1) + 'x'; // placeholder group
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (g === 'x') {
        out.push(-1); // placeholder, replaced by v4Tail below
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]!);
  if (head === null) return null;
  let groups: number[];
  if (halves.length === 2) {
    const tail = parseGroups(halves[1]!);
    if (tail === null) return null;
    const fill = 8 - (head.length + tail.length) - (v4Tail ? 1 : 0);
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  // swap in the v4 tail (placeholder occupies one group slot, expands to two)
  const idx = groups.indexOf(-1);
  if (v4Tail) {
    if (idx === -1) return null;
    groups.splice(idx, 1, ...v4Tail);
  } else if (idx !== -1) {
    return null;
  }
  if (groups.length !== 8 || groups.some((g) => g < 0 || g > 0xffff)) return null;
  return groups;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
}

export function isPublicIpv6(addr: string): boolean {
  if (addr.includes('%')) return false; // zoned = link-scoped
  const g = parseIpv6(addr);
  if (g === null) return false;

  const isZero = g.every((x) => x === 0);
  if (isZero) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1

  // v4-mapped ::ffff:0:0/96 and v4-compatible ::/96 → judge the embedded v4
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4(v4FromGroups(g[6]!, g[7]!));
  }
  // NAT64 64:ff9b::/96 → judge the embedded v4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIpv4(v4FromGroups(g[6]!, g[7]!));
  }

  const top = g[0]!;
  if ((top & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((top & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((top & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (top === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // 100::/64 discard
  if (top === 0x2001 && g[1]! === 0) return false; // 2001:0::/32 teredo (tunnels arbitrary v4)
  if (top === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (top === 0x2002) {
    // 6to4 2002::/16 — tunnels an embedded v4; judge it
    return isPublicIpv4(v4FromGroups(g[1]!, g[2]!));
  }
  return true;
}

/** True only for a provably public unicast address (v4 or v6 literal). */
export function isPublicIp(addr: string): boolean {
  if (addr.includes(':')) return isPublicIpv6(addr);
  return isPublicIpv4(addr);
}
