import type {
  CreatorPollResultsDto,
  EpisodePollDto,
  EpisodePollPutBody,
  PublicPollDto,
  PublicPollResultsDto,
} from '@harborfm/shared';
import { apiGet, apiPut, apiPost } from './client';

export type { EpisodePollDto, CreatorPollResultsDto, PublicPollDto, PublicPollResultsDto };

export function getEpisodePoll(episodeId: string) {
  return apiGet<EpisodePollDto>(`/episodes/${encodeURIComponent(episodeId)}/poll`);
}

export function putEpisodePoll(episodeId: string, body: EpisodePollPutBody) {
  return apiPut<EpisodePollDto>(`/episodes/${encodeURIComponent(episodeId)}/poll`, body);
}

export function getEpisodePollResults(
  episodeId: string,
  verified: 'all' | 'verified' | 'unverified' = 'all',
) {
  const q = verified === 'all' ? '' : `?verified=${verified}`;
  return apiGet<CreatorPollResultsDto>(
    `/episodes/${encodeURIComponent(episodeId)}/poll/results${q}`,
  );
}

export function getPublicPoll(podcastSlug: string, episodeSlug: string) {
  return apiGet<PublicPollDto>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/poll`,
  );
}

export function votePublicPoll(
  podcastSlug: string,
  episodeSlug: string,
  body: {
    answers: Array<{ questionId: string; optionId?: string; textValue?: string }>;
    email?: string;
    captchaToken?: string;
  },
) {
  return apiPost<{
    ok: boolean;
    alreadyVoted?: boolean;
    verificationRequired?: boolean;
    results?: PublicPollResultsDto;
  }>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/poll/vote`,
    body,
  );
}

export function getPublicPollResults(podcastSlug: string, episodeSlug: string) {
  return apiGet<PublicPollResultsDto>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/episodes/${encodeURIComponent(episodeSlug)}/poll/results`,
  );
}
