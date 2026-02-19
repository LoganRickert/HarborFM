import type { FastifyBaseLogger } from "fastify";
import { readSettings } from "../../modules/settings/index.js";
import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { podcasts } from "../../db/schema.js";
import { ensureCnameForPodcast, getEffectiveDomain, type DnsLogger } from "./cloudflare.js";

const CERT_WARMUP_DELAY_MS = 30_000;
const CERT_WARMUP_FETCH_TIMEOUT_MS = 10_000;

/**
 * After a successful DNS update, hit https://domain to trigger certificate activation.
 * Fire-and-forget: wait 30s then fetch with 10s timeout so the user is less likely to see an expired cert.
 */
function scheduleCertificateWarmup(domain: string, log: DnsLogger): void {
  setTimeout(() => {
    const url = `https://${domain}`;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), CERT_WARMUP_FETCH_TIMEOUT_MS);
    fetch(url, { signal: ac.signal })
      .then(() => {
        clearTimeout(timeoutId);
        log.info?.("Certificate warmup request completed", { domain });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        log.error?.(err, "Certificate warmup request failed");
      });
  }, CERT_WARMUP_DELAY_MS);
}

/**
 * Load podcast and settings, then run Cloudflare DNS update if applicable.
 * On success, schedules a certificate warmup (30s delay, then GET with 10s timeout).
 * Fire-and-forget from PATCH handler; errors are logged only.
 */
export async function runDnsUpdateTask(
  podcastId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const logger: DnsLogger = log
    ? { info: (msg, ctx) => log.info?.(ctx ?? {}, msg), error: (err, msg) => log.error?.(err, msg) }
    : { error: console.error, info: (msg) => console.log(msg) };
  try {
    const row = drizzleDb
      .select({
        id: podcasts.id,
        linkDomain: podcasts.linkDomain,
        managedDomain: podcasts.managedDomain,
        managedSubDomain: podcasts.managedSubDomain,
        cloudflareApiKeyEnc: podcasts.cloudflareApiKeyEnc,
      })
      .from(podcasts)
      .where(eq(podcasts.id, podcastId))
      .limit(1)
      .get();
    if (!row) return;
    const settings = readSettings();
    if (settings.dns_provider !== "cloudflare") return;
    await ensureCnameForPodcast(podcastId, row, settings, logger);
    const domain = getEffectiveDomain(row, settings);
    if (domain) scheduleCertificateWarmup(domain, logger);
  } catch (err) {
    if (logger.error) logger.error(err, "DNS update task failed");
  }
}
