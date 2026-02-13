export interface DnsLogger {
  info?: (msg: string, ctx?: Record<string, unknown>) => void;
  error?: (err: unknown, msg?: string) => void;
}
import { DNS_SECRETS_AAD } from "../../config.js";
import type { AppSettings } from "../../modules/settings/routes.js";
import { decryptSecret, isEncryptedSecret } from "../secrets.js";

type PodcastDnsRow = {
  id: string;
  link_domain: string | null;
  managed_domain: string | null;
  managed_sub_domain: string | null;
  cloudflare_api_key_enc: string | null;
};

/** Effective custom domain for this podcast (link, managed, or sub.default). */
export function getEffectiveDomain(row: PodcastDnsRow, settings: AppSettings): string | null {
  const link = row.link_domain?.trim();
  if (link) return link;
  const managed = row.managed_domain?.trim();
  if (managed) return managed;
  const sub = row.managed_sub_domain?.trim();
  const defaultDomain = settings.dns_default_domain?.trim();
  if (sub && defaultDomain) return `${sub}.${defaultDomain}`;
  return null;
}

/** All domains that could have a CNAME for this podcast (link, managed, or sub.default). */
function getAllCandidateDomains(row: PodcastDnsRow, settings: AppSettings): string[] {
  const out: string[] = [];
  const link = row.link_domain?.trim();
  if (link) out.push(link.toLowerCase());
  const managed = row.managed_domain?.trim();
  if (managed) out.push(managed.toLowerCase());
  const sub = row.managed_sub_domain?.trim();
  const defaultDomain = settings.dns_default_domain?.trim();
  if (sub && defaultDomain) out.push(`${sub}.${defaultDomain}`.toLowerCase());
  return [...new Set(out)];
}

function getEffectiveApiToken(
  row: PodcastDnsRow,
  settings: AppSettings,
): string | null {
  if (row.cloudflare_api_key_enc && isEncryptedSecret(row.cloudflare_api_key_enc)) {
    try {
      return decryptSecret(row.cloudflare_api_key_enc, DNS_SECRETS_AAD);
    } catch {
      return null;
    }
  }
  if (settings.dns_provider_api_token_enc && isEncryptedSecret(settings.dns_provider_api_token_enc)) {
    try {
      return decryptSecret(settings.dns_provider_api_token_enc, DNS_SECRETS_AAD);
    } catch {
      return null;
    }
  }
  return null;
}

type CfClient = InstanceType<typeof import("cloudflare").default>;

/** Zone list response shape. */
type ZonesResult = { result: Array<{ id: string; name: string }> };

/**
 * Find the Cloudflare zone that contains the given domain.
 * Tries candidate zone names from longest to shortest (e.g. bar.example.co.uk, example.co.uk, co.uk)
 * so multi-part TLDs like co.uk resolve to the correct zone (example.co.uk).
 */
async function findZoneForDomain(
  domain: string,
  cf: CfClient,
): Promise<{ id: string; name: string } | null> {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  for (let n = labels.length; n >= 2; n--) {
    const candidateZoneName = labels.slice(-n).join(".");
    const zonesPage = await cf.zones.list({ name: candidateZoneName });
    const zones = "result" in zonesPage ? (zonesPage as ZonesResult).result : [];
    const zone = zones[0];
    if (zone?.id && zone.name === candidateZoneName) return zone;
  }
  return null;
}

/**
 * Delete CNAME record for the given domain if it exists and points to our targetHost (so we only remove records we created).
 */
async function deleteCnameIfOurs(
  domain: string,
  targetHost: string,
  cf: CfClient,
  log: DnsLogger,
): Promise<void> {
  const zone = await findZoneForDomain(domain, cf);
  if (!zone?.id) return;
  const recordName = domain.endsWith(zone.name)
    ? domain.slice(0, -zone.name.length - 1) || zone.name
    : domain;
  const fullName = recordName === zone.name ? zone.name : `${recordName}.${zone.name}`;
  const listParams = { zone_id: zone.id, type: "CNAME" as const, name: fullName };
  const recordsPage = await cf.dns.records.list(listParams as Parameters<typeof cf.dns.records.list>[0]);
  const records = "result" in recordsPage ? (recordsPage as { result: Array<{ id: string; content?: string; type?: string }> }).result : [];
  const existing = records[0];
  if (existing && existing.type === "CNAME" && (existing.content ?? "").toLowerCase() === targetHost.toLowerCase()) {
    await cf.dns.records.delete(existing.id, { zone_id: zone.id } as Parameters<typeof cf.dns.records.delete>[1]);
    log.info?.("Cloudflare: deleted old CNAME (switching domain)", { domain, targetHost });
  }
}

/**
 * Delete A record for the given domain if it exists and content equals our IP.
 */
async function deleteARecordIfOurs(
  domain: string,
  ip: string,
  cf: CfClient,
  log: DnsLogger,
): Promise<void> {
  const zone = await findZoneForDomain(domain, cf);
  if (!zone?.id) return;
  const recordName = domain.endsWith(zone.name)
    ? domain.slice(0, -zone.name.length - 1) || zone.name
    : domain;
  const fullName = recordName === zone.name ? zone.name : `${recordName}.${zone.name}`;
  const listParams = { zone_id: zone.id, type: "A" as const, name: fullName };
  const recordsPage = await cf.dns.records.list(listParams as Parameters<typeof cf.dns.records.list>[0]);
  const records = "result" in recordsPage ? (recordsPage as { result: Array<{ id: string; content?: string; type?: string }> }).result : [];
  const existing = records[0];
  if (existing && existing.type === "A" && (existing.content ?? "").trim() === ip.trim()) {
    await cf.dns.records.delete(existing.id, { zone_id: zone.id } as Parameters<typeof cf.dns.records.delete>[1]);
    log.info?.("Cloudflare: deleted old A record (switching domain)", { domain, ip });
  }
}

/**
 * Ensure one DNS record exists for the podcast's custom domain: either CNAME to hostname or A to dns_a_record_ip.
 * When Use CNAME is disabled and no A record IP is set, does nothing.
 */
export async function ensureCnameForPodcast(
  podcastId: string,
  row: PodcastDnsRow,
  settings: AppSettings,
  log: DnsLogger,
): Promise<void> {
  const useCname = settings.dns_use_cname ?? true;
  const aRecordIp = (settings.dns_a_record_ip ?? "").trim();
  if (!useCname && !aRecordIp) return;

  const effectiveDomain = getEffectiveDomain(row, settings);
  const token = getEffectiveApiToken(row, settings);
  if (!token) return;
  const hostname = settings.hostname?.trim();
  if (!hostname) return;
  let targetHost: string;
  try {
    const u = new URL(hostname.startsWith("http") ? hostname : `https://${hostname}`);
    targetHost = u.hostname;
  } catch {
    targetHost = hostname.replace(/^https?:\/\//, "").split("/")[0] ?? hostname;
  }
  const proxied = settings.dns_default_enable_cloudflare_proxy ?? false;
  try {
    const Cloudflare = (await import("cloudflare")).default;
    const cf = new Cloudflare({ apiToken: token });

    const candidates = getAllCandidateDomains(row, settings);
    const effectiveLower = effectiveDomain?.toLowerCase() ?? null;
    for (const d of candidates) {
      if (d !== effectiveLower) {
        await deleteCnameIfOurs(d, targetHost, cf, log);
        if (aRecordIp) await deleteARecordIfOurs(d, aRecordIp, cf, log);
      }
    }

    const domain = effectiveDomain;
    if (!domain) return;
    const zone = await findZoneForDomain(domain, cf);
    if (!zone?.id) {
      log.info?.("Cloudflare: no zone found for domain", { domain });
      return;
    }
    const recordName = domain.endsWith(zone.name)
      ? domain.slice(0, -zone.name.length - 1) || zone.name
      : domain;
    const fullName = recordName === zone.name ? zone.name : `${recordName}.${zone.name}`;

    if (useCname) {
      await deleteARecordIfOurs(domain, aRecordIp, cf, log);
      const listParams = { zone_id: zone.id, type: "CNAME" as const, name: fullName };
      const recordsPage = await cf.dns.records.list(listParams as Parameters<typeof cf.dns.records.list>[0]);
      const records = "result" in recordsPage ? (recordsPage as { result: Array<{ id: string; content?: string; proxied?: boolean }> }).result : [];
      const existing = records[0];
      const content = targetHost;
      if (existing) {
        if (existing.content === content && existing.proxied === proxied) return;
        const editParams = { zone_id: zone.id, type: "CNAME" as const, name: fullName, content, ttl: 1 as const, proxied };
        await cf.dns.records.edit(existing.id, editParams as Parameters<typeof cf.dns.records.edit>[1]);
        log.info?.("Cloudflare: updated CNAME", { domain, targetHost });
      } else {
        const createParams = { zone_id: zone.id, type: "CNAME" as const, name: fullName, content, ttl: 1 as const, proxied };
        await cf.dns.records.create(createParams as Parameters<typeof cf.dns.records.create>[0]);
        log.info?.("Cloudflare: created CNAME", { domain, targetHost });
      }
    } else {
      await deleteCnameIfOurs(domain, targetHost, cf, log);
      const listParams = { zone_id: zone.id, type: "A" as const, name: fullName };
      const recordsPage = await cf.dns.records.list(listParams as Parameters<typeof cf.dns.records.list>[0]);
      const records = "result" in recordsPage ? (recordsPage as { result: Array<{ id: string; content?: string; proxied?: boolean }> }).result : [];
      const existing = records[0];
      const content = aRecordIp;
      if (existing) {
        if (existing.content === content && existing.proxied === proxied) return;
        const editParams = { zone_id: zone.id, type: "A" as const, name: fullName, content, ttl: 1 as const, proxied };
        await cf.dns.records.edit(existing.id, editParams as Parameters<typeof cf.dns.records.edit>[1]);
        log.info?.("Cloudflare: updated A record", { domain, content });
      } else {
        const createParams = { zone_id: zone.id, type: "A" as const, name: fullName, content, ttl: 1 as const, proxied };
        await cf.dns.records.create(createParams as Parameters<typeof cf.dns.records.create>[0]);
        log.info?.("Cloudflare: created A record", { domain, content });
      }
    }
  } catch (err) {
    log.error?.(err, "Cloudflare DNS update failed");
    throw err;
  }
}
