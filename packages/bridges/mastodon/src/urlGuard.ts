// Guard for attachment URLs that arrive from remote Mastodon users.
//
// `handleNotification` fetches image URLs straight out of an incoming
// notification, and with `MASTODON_ALLOWED_ACCTS` unset every account on the
// fediverse can reach that path — so an unchecked fetch is a server-side
// request forgery primitive against whatever the bridge host can see
// (loopback services, RFC1918 neighbours, the cloud metadata endpoint).
//
// Residual risk worth knowing: the DNS answer we validate is not the one the
// subsequent fetch necessarily uses, so a rebinding attacker with a very short
// TTL can still slip through. Pinning the resolved address into the connection
// would need a custom agent; this raises the bar without that surgery.

/* eslint-disable sonarjs/no-hardcoded-ip -- the blocked ranges ARE this module's
   specification; writing them as literals is the point, not an oversight. */

import { lookup } from "node:dns/promises";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal"];

/** IPv4 ranges that must never be fetched, as [firstAddress, prefixLength]. */
const BLOCKED_V4_RANGES: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 metadata endpoint
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isBlockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return BLOCKED_V4_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) return false;
    // `>>> 0` keeps the mask unsigned; a /0 shift would be a no-op anyway.
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  // IPv4-mapped (::ffff:127.0.0.1) re-enters the v4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedV4(mapped[1]);
  const [head] = lower.split(":");
  if (head.length === 0) return false;
  const leading = Number.parseInt(head, 16);
  if (Number.isNaN(leading)) return false;
  if ((leading & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True when this literal address is one the bridge must never fetch. Pure —
 *  the DNS-dependent decision lives in `resolvePublicUrl`. */
export function isBlockedAddress(address: string): boolean {
  return address.includes(":") ? isBlockedV6(address) : isBlockedV4(address);
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** Parse and apply every check that doesn't need the network: shape, scheme,
 *  obviously-internal hostname, and literal addresses. Returns null on reject. */
export function parseSafeUrlShape(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.length === 0) return null;
  if (isBlockedHostname(hostname)) return null;
  if (isBlockedAddress(hostname)) return null;
  return url;
}

/** Full check: shape rules, then every address the hostname resolves to.
 *  Returns the URL when it's safe to fetch, or null when it must be refused. */
export async function resolvePublicUrl(raw: string): Promise<URL | null> {
  const url = parseSafeUrlShape(raw);
  if (url === null) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // A literal address was already vetted above and has nothing to resolve.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return url;
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return null;
    return addresses.every((entry) => !isBlockedAddress(entry.address)) ? url : null;
  } catch {
    return null;
  }
}
