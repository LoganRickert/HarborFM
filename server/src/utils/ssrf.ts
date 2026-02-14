import { lookup } from "dns/promises";
import { IMPORT_ALLOW_PRIVATE_URLS } from "../config.js";

/**
 * SSRF protection: reject URLs that resolve to private/internal IP addresses.
 * Blocks: loopback, private IPv4, link-local, IPv6 equivalents.
 * Use before any fetch of user-provided or feed-provided URLs (e.g. import).
 * Set IMPORT_ALLOW_PRIVATE_URLS=true to bypass (dev/testing only).
 */

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255))
    return false;
  const [a, b] = nums;
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  const first = lower.split(":")[0] ?? "";
  if (first === "fe80") return true; // fe80::/10 link-local
  if (first === "fc" || first === "fd") return true; // fc00::/7 unique local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped: ::ffff:127.0.0.1 etc
    const v4 = lower.slice(7);
    if (isPrivateIPv4(v4)) return true;
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (!lower) return true;
  if (
    lower === "localhost" ||
    lower === "localhost." ||
    lower.endsWith(".localhost")
  )
    return true;
  return false;
}

async function isPrivateResolved(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const a of addresses) {
      const ip = a.address;
      if (isPrivateIPv4(ip) || isPrivateIPv6(ip)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Throws if the URL points to a private/internal address.
 * Call before fetching user-provided or feed-provided URLs.
 */
export async function assertUrlNotPrivate(url: string): Promise<void> {
  if (IMPORT_ALLOW_PRIVATE_URLS) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  const hostname = parsed.hostname;
  if (!hostname) throw new Error("URL has no hostname");

  if (isBlockedHostname(hostname)) {
    throw new Error("URL hostname is not allowed");
  }

  if (isPrivateIPv4(hostname)) {
    throw new Error("URL points to a private network address");
  }

  if (isPrivateIPv6(hostname)) {
    throw new Error("URL points to a private network address");
  }

  const isPrivate = await isPrivateResolved(hostname);
  if (isPrivate) {
    throw new Error("URL resolves to a private network address");
  }
}
