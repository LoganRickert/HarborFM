import { truncatePlain, type AlertVars } from "./alertVars.js";

export function buildDiscordEpisodeEmbed(vars: AlertVars): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title: truncatePlain(vars.title, 256),
    url: vars.episodeUrl,
    color: 0x00d4aa,
    author: { name: truncatePlain(vars.podcastTitle, 256) },
  };
  if (vars.description) {
    embed.description = truncatePlain(vars.description, 4096);
  }
  if (vars.artworkUrl) {
    // Large cover art; Discord clients show this prominently under the embed.
    embed.image = { url: vars.artworkUrl };
  }
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (vars.seasonEpisode) {
    fields.push({ name: "Episode", value: vars.seasonEpisode, inline: true });
  }
  if (vars.premium === "true") {
    fields.push({ name: "Access", value: "Subscribers only", inline: true });
  }
  if (fields.length > 0) embed.fields = fields;
  return embed;
}

/** Structured lines for plain-text community defaults. */
function buildDefaultAlertLines(
  vars: AlertVars,
  opts?: { descriptionMax?: number; includeArtworkUrl?: boolean },
): string[] {
  const descriptionMax = opts?.descriptionMax ?? 400;
  const lines: string[] = [
    vars.podcastTitle,
    vars.title,
  ];
  if (vars.seasonEpisode) lines.push(vars.seasonEpisode);
  if (vars.premium === "true") lines.push("Subscribers only");
  if (vars.description) {
    lines.push("", truncatePlain(vars.description, descriptionMax));
  }
  lines.push("", vars.episodeUrl);
  if (opts?.includeArtworkUrl && vars.artworkUrl) {
    lines.push("", vars.artworkUrl);
  }
  return lines;
}

export function buildDefaultAlertText(
  vars: AlertVars,
  opts?: { descriptionMax?: number; includeArtworkUrl?: boolean; maxLen?: number },
): string {
  const text = buildDefaultAlertLines(vars, opts).join("\n");
  if (opts?.maxLen) return truncatePlain(text, opts.maxLen);
  return text;
}

function escapeSlackMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSlackEpisodeBlocks(vars: AlertVars): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncatePlain(vars.title, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${escapeSlackMrkdwn(vars.podcastTitle)}*`,
          vars.seasonEpisode
            ? `_${escapeSlackMrkdwn(vars.seasonEpisode)}_`
            : null,
          vars.premium === "true" ? "_Subscribers only_" : null,
          vars.description
            ? escapeSlackMrkdwn(truncatePlain(vars.description, 500))
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    },
  ];
  if (vars.artworkUrl) {
    blocks.push({
      type: "image",
      image_url: vars.artworkUrl,
      alt_text: truncatePlain(vars.title, 100) || "Episode artwork",
    });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Listen now", emoji: true },
        url: vars.episodeUrl,
        action_id: "episode_alerts_listen",
      },
    ],
  });
  return blocks;
}

function escapeHtmlLite(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTelegramCaption(vars: AlertVars): string {
  const parts = [
    `<b>${escapeHtmlLite(vars.podcastTitle)}</b>`,
    `<b>${escapeHtmlLite(vars.title)}</b>`,
  ];
  if (vars.seasonEpisode) parts.push(escapeHtmlLite(vars.seasonEpisode));
  if (vars.premium === "true") parts.push("<i>Subscribers only</i>");
  if (vars.description) {
    parts.push("", escapeHtmlLite(truncatePlain(vars.description, 600)));
  }
  parts.push("", `<a href="${escapeHtmlLite(vars.episodeUrl)}">Listen now</a>`);
  return truncatePlain(parts.join("\n"), 1024);
}

export function buildMastodonDefaultStatus(vars: AlertVars): string {
  // Put episode URL early so Mastodon can unfurl a card.
  const header = [
    `New episode from ${vars.podcastTitle}`,
    vars.title,
    vars.seasonEpisode || null,
    vars.premium === "true" ? "Subscribers only" : null,
    vars.episodeUrl,
  ]
    .filter(Boolean)
    .join("\n");
  const budget = Math.max(0, 500 - header.length - 2);
  if (budget < 40 || !vars.description) return truncatePlain(header, 500);
  return truncatePlain(
    `${header}\n\n${truncatePlain(vars.description, budget)}`,
    500,
  );
}

export function buildLemmyDefaultTitle(vars: AlertVars): string {
  const base = `${vars.podcastTitle}: ${vars.title}`;
  if (vars.seasonEpisode) {
    return truncatePlain(`${base} (${vars.seasonEpisode})`, 200);
  }
  return truncatePlain(base, 200);
}

export function buildLemmyDefaultBody(vars: AlertVars): string {
  const parts: string[] = [];
  if (vars.premium === "true") parts.push("Subscribers only");
  if (vars.description) parts.push(vars.description);
  parts.push("", `Listen: ${vars.episodeUrl}`);
  return parts.join("\n").trim();
}

export function buildBlueskyDefaultText(vars: AlertVars): string {
  return buildDefaultAlertText(vars, {
    descriptionMax: 120,
    maxLen: 300,
  });
}

export async function uploadBlueskyThumb(
  accessJwt: string,
  artworkUrl: string,
): Promise<{
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
} | null> {
  try {
    const imgRes = await fetch(artworkUrl);
    if (!imgRes.ok) return null;
    const mimeType = (imgRes.headers.get("content-type") || "image/jpeg").split(
      ";",
    )[0]!.trim();
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 1_000_000) return null;
    const uploadRes = await fetch(
      "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessJwt}`,
          "Content-Type": mimeType,
        },
        body: buf,
      },
    );
    if (!uploadRes.ok) return null;
    const data = (await uploadRes.json()) as {
      blob?: {
        $type: "blob";
        ref: { $link: string };
        mimeType: string;
        size: number;
      };
    };
    return data.blob ?? null;
  } catch {
    return null;
  }
}
