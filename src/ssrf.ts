import { lookup } from "node:dns/promises";

const PRIVATE_V4 = [
  { net: "0.0.0.0/8" },
  { net: "10.0.0.0/8" },
  { net: "100.64.0.0/10" },
  { net: "127.0.0.0/8" },
  { net: "169.254.0.0/16" },
  { net: "172.16.0.0/12" },
  { net: "192.0.0.0/24" },
  { net: "192.168.0.0/16" },
  { net: "198.18.0.0/15" },
  { net: "224.0.0.0/4" },
  { net: "240.0.0.0/4" },
];

function v4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error("bad ipv4");
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(net) & mask);
}

export function isPrivateV4(ip: string): boolean {
  try {
    return PRIVATE_V4.some((p) => cidrMatch(ip, p.net));
  } catch {
    return true;
  }
}

export function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // link-local, ULA
  if (s.startsWith("ff")) return true; // multicast
  if (s.startsWith("::ffff:")) return isPrivateV4(s.slice(7)); // v4-mapped
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("modelUrl is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("only https:// URLs are allowed");
  }
  const host = url.hostname;
  const bare = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || bare === "localhost") throw new Error("host is not allowed");
  if (bare.includes(".")) {
    if (bare.endsWith(".local") || bare.endsWith(".internal")) throw new Error("host is not allowed");
    // literal IP
    if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) {
      if (isPrivateV4(bare)) throw new Error("host is not allowed");
    } else if (bare.includes(":")) {
      if (isPrivateV6(bare)) throw new Error("host is not allowed");
    }
  } else if (bare.includes(":")) {
    if (isPrivateV6(bare)) throw new Error("host is not allowed");
  } else {
    // single-label hostname — block
    throw new Error("host is not allowed");
  }
  return url;
}

/** Resolve hostname and ensure every address is public. Prevents DNS-rebinding at connect time. */
export async function assertResolvesPublic(url: URL): Promise<void> {
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":")) return; // literal, already checked
  const addrs = await lookup(bare, { all: true, verbatim: true });
  if (addrs.length === 0) throw new Error("host does not resolve");
  for (const a of addrs) {
    if (a.family === 4 ? isPrivateV4(a.address) : isPrivateV6(a.address)) {
      throw new Error("host resolves to a private address");
    }
  }
}
