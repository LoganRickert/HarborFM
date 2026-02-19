export type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  podcastId: string | null;
  episodeId: string | null;
  podcastTitle: string | null;
  episodeTitle: string | null;
};

export function toContactMessage(r: ContactMessageRow) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    message: r.message,
    createdAt: r.createdAt,
    podcastId: r.podcastId,
    episodeId: r.episodeId,
    podcastTitle: r.podcastTitle,
    episodeTitle: r.episodeTitle,
  };
}
