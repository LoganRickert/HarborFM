import * as episodesRepo from "../episodes/repo.js";
import * as podcastsRepo from "../podcasts/repo.js";
import * as usersRepo from "../users/repo.js";

/** Optional show/episode/user context for admin worker status and job stats. */
export type WorkerJobSubject = {
  podcastId?: string | null;
  episodeId?: string | null;
  segmentId?: string | null;
  podcastTitle?: string | null;
  episodeTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userUsername?: string | null;
};

/** Resolve titles and user labels for a worker job subject. */
export function resolveWorkerJobSubject(opts: {
  podcastId?: string | null;
  episodeId?: string | null;
  segmentId?: string | null;
  userId?: string | null;
}): WorkerJobSubject {
  const podcastId = opts.podcastId?.trim() || null;
  const episodeId = opts.episodeId?.trim() || null;
  const segmentId = opts.segmentId?.trim() || null;
  const userId = opts.userId?.trim() || null;
  let podcastTitle: string | null = null;
  let episodeTitle: string | null = null;
  let resolvedPodcastId = podcastId;
  let userEmail: string | null = null;
  let userUsername: string | null = null;

  if (podcastId) {
    const podcast = podcastsRepo.getById(podcastId);
    podcastTitle = podcast?.title?.trim() || null;
  }
  if (episodeId) {
    const episode = episodesRepo.getById(episodeId);
    episodeTitle = episode?.title?.trim() || null;
    if (!resolvedPodcastId && episode?.podcastId) {
      resolvedPodcastId = episode.podcastId;
      const podcast = podcastsRepo.getById(episode.podcastId);
      podcastTitle = podcast?.title?.trim() || null;
    }
  }
  if (userId) {
    const user = usersRepo.getUserById(userId);
    userEmail = user?.email?.trim() || null;
    userUsername = user?.username?.trim() || null;
  }

  return {
    podcastId: resolvedPodcastId,
    episodeId,
    segmentId,
    podcastTitle,
    episodeTitle,
    userId,
    userEmail,
    userUsername,
  };
}
