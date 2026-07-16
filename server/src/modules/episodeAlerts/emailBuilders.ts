import { APP_NAME } from "../../config.js";

const STYLE = {
  bg: "#0c0e12",
  bgElevated: "#14171e",
  text: "#e8eaef",
  textMuted: "#8b92a3",
  accent: "#00d4aa",
  border: "#2a2f3d",
  fontSans: "'DM Sans', system-ui, sans-serif",
};

const DESCRIPTION_MAX = 600;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function formatSeasonEpisodeLabel(
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (seasonNumber != null && Number.isFinite(seasonNumber)) {
    parts.push(`Season ${seasonNumber}`);
  }
  if (episodeNumber != null && Number.isFinite(episodeNumber)) {
    parts.push(`Episode ${episodeNumber}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function footerHtml(
  mailingAddress: string | null | undefined,
  baseUrl: string,
  unsubscribeUrl?: string,
): string {
  const addr = mailingAddress?.trim();
  const unsub = unsubscribeUrl?.trim()
    ? `<p style="margin: 0 0 12px; font-size: 0.75rem; color: ${STYLE.textMuted}; text-align: center; line-height: 1.5;">
        No longer want these emails?
        <a href="${escapeHtml(unsubscribeUrl)}" style="color: ${STYLE.textMuted}; text-decoration: underline; text-underline-offset: 2px;">Unsubscribe</a>
      </p>`
    : "";
  return `
    <div style="margin: 24px 0 0; text-align: center;">
      ${unsub}
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; line-height: 1.5;">
        <a href="${escapeHtml(baseUrl)}" style="color: inherit; text-decoration: none;">${escapeHtml(APP_NAME)}</a>
        ${addr ? `<br/><span style="font-size: 0.75rem;">${escapeHtml(addr)}</span>` : ""}
      </p>
    </div>`;
}

export function buildEpisodeAlertVerifyEmail(opts: {
  podcastTitle: string;
  verifyUrl: string;
  mailingAddress: string | null;
  baseUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Confirm episode alerts for ${opts.podcastTitle}`;
  const text = [
    `You asked to get episode alerts for ${opts.podcastTitle}.`,
    "",
    "Confirm your email to join the list:",
    opts.verifyUrl,
    "",
    "If you did not request this, you can ignore this email.",
    opts.mailingAddress?.trim() ? `\n${opts.mailingAddress.trim()}` : "",
    "",
    APP_NAME,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      <p style="margin: 0 0 24px; font-size: 1rem; color: ${STYLE.text};">
        Confirm your email to get alerts when <strong>${escapeHtml(opts.podcastTitle)}</strong> publishes a new episode.
      </p>
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${escapeHtml(opts.verifyUrl)}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Confirm email</a>
      </p>
      <p style="margin: 0; font-size: 0.8125rem; color: ${STYLE.textMuted}; text-align: center;">
        If you did not request this, you can ignore this email.
      </p>
    </div>
    ${footerHtml(opts.mailingAddress, opts.baseUrl)}
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function buildEpisodeAlertEmail(opts: {
  podcastTitle: string;
  episodeTitle: string;
  episodeUrl: string;
  unsubscribeUrl: string;
  mailingAddress: string | null;
  baseUrl: string;
  description?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  artworkUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const subject = `New episode: ${opts.episodeTitle} | ${opts.podcastTitle}`;
  const seasonEpisode = formatSeasonEpisodeLabel(
    opts.seasonNumber,
    opts.episodeNumber,
  );
  const descriptionRaw = opts.description?.trim()
    ? truncate(stripHtml(opts.description), DESCRIPTION_MAX)
    : "";
  const artworkUrl = opts.artworkUrl?.trim() || null;

  const textParts = [
    `${opts.podcastTitle} just published a new episode:`,
    "",
    opts.episodeTitle,
    seasonEpisode ?? "",
    descriptionRaw ? `\n${descriptionRaw}` : "",
    "",
    opts.episodeUrl,
    "",
    "No longer want these emails? Unsubscribe:",
    opts.unsubscribeUrl,
    opts.mailingAddress?.trim() ? opts.mailingAddress.trim() : "",
    "",
    APP_NAME,
  ];

  const text = textParts
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const artBlock = artworkUrl
    ? `<p style="margin: 0 0 20px; text-align: center;">
        <a href="${escapeHtml(opts.episodeUrl)}" style="text-decoration: none;">
          <img src="${escapeHtml(artworkUrl)}" alt="" width="200" height="200" style="display: block; margin: 0 auto; width: 200px; height: 200px; object-fit: cover; border-radius: 12px; border: 1px solid ${STYLE.border};" />
        </a>
      </p>`
    : "";

  const metaBlock = seasonEpisode
    ? `<p style="margin: 0 0 ${descriptionRaw ? "12px" : "24px"}; font-size: 0.8125rem; color: ${STYLE.textMuted};">
        ${escapeHtml(seasonEpisode)}
      </p>`
    : "";

  const descBlock = descriptionRaw
    ? `<p style="margin: 0 0 24px; font-size: 0.9375rem; color: ${STYLE.textMuted}; line-height: 1.55;">
        ${escapeHtml(descriptionRaw)}
      </p>`
    : "";

  const titleBottom =
    seasonEpisode || descriptionRaw ? "8px" : "24px";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; font-family: ${STYLE.fontSans}; background: ${STYLE.bg}; color: ${STYLE.text}; line-height: 1.6;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: ${STYLE.bgElevated}; border: 1px solid ${STYLE.border}; border-radius: 16px; padding: 32px 28px;">
      ${artBlock}
      <p style="margin: 0 0 8px; font-size: 0.875rem; color: ${STYLE.textMuted};">
        ${escapeHtml(opts.podcastTitle)}
      </p>
      <p style="margin: 0 0 ${titleBottom}; font-size: 1.125rem; color: ${STYLE.text}; font-weight: 600;">
        ${escapeHtml(opts.episodeTitle)}
      </p>
      ${metaBlock}
      ${descBlock}
      <p style="margin: 0; text-align: center;">
        <a href="${escapeHtml(opts.episodeUrl)}" style="display: inline-block; padding: 12px 24px; background: ${STYLE.accent}; color: ${STYLE.bg}; font-weight: 600; text-decoration: none; border-radius: 8px;">Listen now</a>
      </p>
    </div>
    ${footerHtml(opts.mailingAddress, opts.baseUrl, opts.unsubscribeUrl)}
  </div>
</body>
</html>`;

  return { subject, text, html };
}
