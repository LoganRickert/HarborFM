import {
  buildEpisodeAlertArtworkUrl,
  buildEpisodeAlertEpisodeUrl,
  getEpisodeAlertPublicOrigin,
} from "./publicUrls.js";
import { formatSeasonEpisodeLabel } from "./emailBuilders.js";
import type { EpisodeForAlert, PodcastAlertSettings } from "./repo.js";
import { isCurrentlySubscriberOnly } from "../../utils/subscriberOnlyWindow.js";

export type AlertVars = {
  title: string;
  description: string;
  episodeUrl: string;
  rssUrl: string;
  publishAt: string;
  premium: string;
  podcastTitle: string;
  artworkUrl: string;
  seasonEpisode: string;
};

export function renderTemplate(template: string, vars: AlertVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const k = key as keyof AlertVars;
    return vars[k] ?? "";
  });
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncatePlain(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function buildVars(
  podcast: PodcastAlertSettings,
  episode: EpisodeForAlert,
): AlertVars {
  const origin = getEpisodeAlertPublicOrigin(podcast.id);
  const description = truncatePlain(stripHtml(episode.description ?? ""), 2000);
  return {
    title: episode.title,
    description,
    episodeUrl: buildEpisodeAlertEpisodeUrl(
      podcast.id,
      podcast.slug,
      episode.slug,
    ),
    rssUrl: `${origin}/api/public/rss/${encodeURIComponent(podcast.slug)}.xml`,
    publishAt: episode.publishAt ?? new Date().toISOString(),
    premium: isCurrentlySubscriberOnly(episode) ? "true" : "false",
    podcastTitle: podcast.title,
    artworkUrl: buildEpisodeAlertArtworkUrl(episode) ?? "",
    seasonEpisode:
      formatSeasonEpisodeLabel(episode.seasonNumber, episode.episodeNumber) ??
      "",
  };
}
