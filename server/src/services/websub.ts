import { db } from "../db/index.js";
import { getPublicFeedSelfUrl } from "./rss.js";

/**
 * PubSubHubbub / WebSub: notify the hub that a topic (feed) has been updated.
 * POST to hub URL with application/x-www-form-urlencoded body: hub.mode=publish, hub.url=<topic URL>.
 * See https://pubsubhubbub.github.io/PubSubHubbub/pubsubhubbub-core-0.3.html#publishing
 */
export function notifyWebSubHub(
  podcastId: string,
  publicBaseUrl?: string | null,
): void {
  const enabledRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("websub_discovery_enabled") as { value: string } | undefined;
  if (enabledRow?.value !== "true") return;

  const hubRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("websub_hub") as { value: string } | undefined;
  const hubUrl = hubRow?.value?.trim();
  if (!hubUrl || !hubUrl.startsWith("http")) return;

  const feedUrl = getPublicFeedSelfUrl(podcastId, publicBaseUrl);
  if (!feedUrl) return;

  const body = new URLSearchParams({
    "hub.mode": "publish",
    "hub.url": feedUrl,
  }).toString();

  const timeoutMs = 10_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  fetch(hubUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: controller.signal,
  })
    .finally(() => clearTimeout(timeoutId))
    .catch((err) => {
      console.error("[WebSub] Failed to notify hub:", err?.message ?? err);
    });
}
