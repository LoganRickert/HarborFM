import { apiGet, apiPost } from './client';

export type EpisodeGuestReviewState =
  | {
      state: 'invalid';
    }
  | {
      state: 'redirect_public';
      episodeUrl: string;
      podcastSlug: string;
      episodeSlug: string | null;
    }
  | {
      state: 'review';
      episodeUrl: string;
      podcastSlug: string;
      episodeSlug: string | null;
      episodeTitle: string;
      podcastTitle: string;
      displayName: string | null;
      email: string;
      status: 'pending' | 'approved' | 'feedback' | string;
      feedbackText: string | null;
      audioUrl: string | null;
      waveformUrl?: string | null;
      baseUrl: string;
    };

export function getEpisodeGuestReview(token: string) {
  const q = new URLSearchParams({ token });
  return apiGet<EpisodeGuestReviewState>(
    `/public/episode-review?${q.toString()}`,
  );
}

export function approveEpisodeGuestReview(token: string) {
  return apiPost<{ ok: boolean; status: string }>(
    `/public/episode-review/approve`,
    { token },
  );
}

export function submitEpisodeGuestReviewFeedback(
  token: string,
  message: string,
) {
  return apiPost<{ ok: boolean; status: string }>(
    `/public/episode-review/feedback`,
    { token, message },
  );
}
