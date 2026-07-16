import { decryptConfigSecret } from "./configSecrets.js";
import { renderTemplate, truncatePlain, type AlertVars } from "./alertVars.js";
import {
  buildBlueskyDefaultText,
  buildDefaultAlertText,
  buildDiscordEpisodeEmbed,
  buildLemmyDefaultBody,
  buildLemmyDefaultTitle,
  buildMastodonDefaultStatus,
  buildSlackEpisodeBlocks,
  buildTelegramCaption,
  uploadBlueskyThumb,
} from "./messageBuilders.js";
import type { DestinationRow } from "./repo.js";

async function dispatchDiscord(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const url = String(dest.config.webhookUrl ?? "").trim();
  if (!url) throw new Error("Discord webhook URL missing");
  const custom = String(dest.config.messageTemplate ?? "").trim();
  const payload = custom
    ? { content: renderTemplate(custom, vars).slice(0, 2000) }
    : {
        content: `New episode from **${vars.podcastTitle}**`,
        embeds: [buildDiscordEpisodeEmbed(vars)],
      };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
}

async function dispatchSlack(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const url = String(dest.config.webhookUrl ?? "").trim();
  if (!url) throw new Error("Slack webhook URL missing");
  const custom = String(dest.config.messageTemplate ?? "").trim();
  const payload = custom
    ? { text: renderTemplate(custom, vars) }
    : {
        text: `${vars.podcastTitle}: ${vars.title}\n${vars.episodeUrl}`,
        blocks: buildSlackEpisodeBlocks(vars),
      };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
}

async function dispatchTelegram(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const token = decryptConfigSecret(dest.config, "botToken");
  const chatId = String(dest.config.chatId ?? "").trim();
  if (!token || !chatId) throw new Error("Telegram bot token/chat ID missing");
  const custom = String(dest.config.messageTemplate ?? "").trim();
  const base = `https://api.telegram.org/bot${encodeURIComponent(token)}`;

  if (custom) {
    const text = renderTemplate(custom, vars);
    const res = await fetch(`${base}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) throw new Error(`Telegram send failed: ${res.status}`);
    return;
  }

  const caption = buildTelegramCaption(vars);
  if (vars.artworkUrl) {
    const photoRes = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: vars.artworkUrl,
        caption,
        parse_mode: "HTML",
      }),
    });
    if (photoRes.ok) return;
    // Fall through to text if photo URL is rejected by Telegram
  }

  const res = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status}`);
}

async function dispatchMastodon(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const instance = String(dest.config.instanceUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = decryptConfigSecret(dest.config, "accessToken");
  if (!instance || !token) throw new Error("Mastodon instance/token missing");
  const custom = String(dest.config.statusTemplate ?? "").trim();
  const status = custom
    ? renderTemplate(custom, vars).slice(0, 500)
    : buildMastodonDefaultStatus(vars);
  const res = await fetch(`${instance}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Mastodon post failed: ${res.status}`);
}

async function dispatchMatrix(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const homeserver = String(dest.config.homeserverUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = decryptConfigSecret(dest.config, "accessToken");
  const roomId = String(dest.config.roomId ?? "").trim();
  if (!homeserver || !token || !roomId) {
    throw new Error("Matrix homeserver/token/room missing");
  }
  const custom = String(dest.config.messageTemplate ?? "").trim();
  const body = custom
    ? renderTemplate(custom, vars)
    : buildDefaultAlertText(vars, {
        descriptionMax: 800,
        includeArtworkUrl: true,
      });
  const txnId = `hfm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(
    `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ msgtype: "m.text", body }),
    },
  );
  if (!res.ok) throw new Error(`Matrix send failed: ${res.status}`);
}

async function dispatchLemmy(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const instance = String(dest.config.instanceUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const community = String(dest.config.community ?? "").trim();
  if (!instance || !community) throw new Error("Lemmy instance/community missing");
  let jwt = decryptConfigSecret(dest.config, "jwt");
  if (!jwt) {
    const username = String(dest.config.username ?? "").trim();
    const password = decryptConfigSecret(dest.config, "password");
    if (!username || !password) throw new Error("Lemmy JWT or username/password missing");
    const loginRes = await fetch(`${instance}/api/v3/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: username, password }),
    });
    if (!loginRes.ok) throw new Error(`Lemmy login failed: ${loginRes.status}`);
    const loginData = (await loginRes.json()) as { jwt?: string };
    jwt = loginData.jwt ?? null;
    if (!jwt) throw new Error("Lemmy login did not return jwt");
  }
  const titleCustom = String(dest.config.titleTemplate ?? "").trim();
  const bodyCustom = String(dest.config.bodyTemplate ?? "").trim();
  const name = titleCustom
    ? renderTemplate(titleCustom, vars).slice(0, 200)
    : buildLemmyDefaultTitle(vars);
  const body = bodyCustom
    ? renderTemplate(bodyCustom, vars)
    : buildLemmyDefaultBody(vars);
  const res = await fetch(`${instance}/api/v3/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      name,
      body,
      community_id: Number.isFinite(Number(community))
        ? Number(community)
        : undefined,
      community_name: Number.isFinite(Number(community)) ? undefined : community,
      url: vars.episodeUrl,
    }),
  });
  if (!res.ok) throw new Error(`Lemmy post failed: ${res.status}`);
}

async function dispatchBluesky(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const handle = String(dest.config.handle ?? "").trim();
  const appPassword = decryptConfigSecret(dest.config, "appPassword");
  if (!handle || !appPassword) throw new Error("Bluesky handle/app password missing");
  const createSession = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!createSession.ok) throw new Error(`Bluesky auth failed: ${createSession.status}`);
  const session = (await createSession.json()) as {
    accessJwt?: string;
    did?: string;
  };
  if (!session.accessJwt || !session.did) throw new Error("Bluesky session incomplete");

  const custom = String(dest.config.postTemplate ?? "").trim();
  const text = custom
    ? renderTemplate(custom, vars).slice(0, 300)
    : buildBlueskyDefaultText(vars);

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };

  if (!custom && vars.episodeUrl) {
    const external: Record<string, unknown> = {
      uri: vars.episodeUrl,
      title: truncatePlain(vars.title, 300),
      description: truncatePlain(
        vars.description || `${vars.podcastTitle}: new episode`,
        1000,
      ),
    };
    if (vars.artworkUrl) {
      const thumb = await uploadBlueskyThumb(session.accessJwt, vars.artworkUrl);
      if (thumb) external.thumb = thumb;
    }
    record.embed = {
      $type: "app.bsky.embed.external",
      external,
    };
  }

  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });
  if (!res.ok) throw new Error(`Bluesky post failed: ${res.status}`);
}

async function dispatchJsonWebhook(dest: DestinationRow, vars: AlertVars): Promise<void> {
  const url = String(dest.config.url ?? "").trim();
  if (!url) throw new Error("JSON webhook URL missing");
  const method = (String(dest.config.method ?? "POST").toUpperCase() ||
    "POST") as "POST" | "PUT" | "PATCH";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const headersRaw = String(dest.config.headersJson ?? "").trim();
  if (headersRaw) {
    try {
      const parsed = JSON.parse(headersRaw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") headers[k] = v;
      }
    } catch {
      throw new Error("Invalid headers JSON");
    }
  }
  const bodyTemplate =
    String(dest.config.bodyTemplate ?? "").trim() ||
    JSON.stringify(
      {
        title: "{{title}}",
        description: "{{description}}",
        episodeUrl: "{{episodeUrl}}",
        rssUrl: "{{rssUrl}}",
        publishAt: "{{publishAt}}",
        premium: "{{premium}}",
        podcastTitle: "{{podcastTitle}}",
        artworkUrl: "{{artworkUrl}}",
        seasonEpisode: "{{seasonEpisode}}",
      },
      null,
      2,
    );
  const body = renderTemplate(bodyTemplate, vars);
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`JSON webhook failed: ${res.status}`);
}

export async function dispatchCommunity(
  dest: DestinationRow,
  vars: AlertVars,
): Promise<void> {
  switch (dest.type) {
    case "discord":
      return dispatchDiscord(dest, vars);
    case "slack":
      return dispatchSlack(dest, vars);
    case "telegram":
      return dispatchTelegram(dest, vars);
    case "mastodon":
      return dispatchMastodon(dest, vars);
    case "matrix":
      return dispatchMatrix(dest, vars);
    case "lemmy":
      return dispatchLemmy(dest, vars);
    case "bluesky":
      return dispatchBluesky(dest, vars);
    case "json_webhook":
      return dispatchJsonWebhook(dest, vars);
    default:
      return;
  }
}
