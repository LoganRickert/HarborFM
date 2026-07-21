import type {
  PublicReviewDto,
  AdminReviewDto,
  AdminReviewsListResponse,
  ReviewsListResponse,
} from '@harborfm/shared';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export type { PublicReviewDto, AdminReviewDto, AdminReviewsListResponse, ReviewsListResponse };

export interface SubmitReviewBody {
  podcastSlug: string;
  episodeSlug?: string;
  name: string;
  email?: string;
  rating: number;
  body: string;
  captchaToken?: string;
}

export function submitReview(body: SubmitReviewBody) {
  return apiPost<{ ok: boolean; id?: string; verificationRequired?: boolean }>('/public/reviews', body);
}

export function getPublicReviews(
  podcastSlug: string,
  options?: { episodeSlug?: string; limit?: number; offset?: number }
): Promise<ReviewsListResponse> {
  const params = new URLSearchParams();
  if (options?.episodeSlug) params.set('episodeSlug', options.episodeSlug);
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.offset != null) params.set('offset', String(options.offset));
  const q = params.toString();
  return apiGet<ReviewsListResponse>(
    `/public/podcasts/${encodeURIComponent(podcastSlug)}/reviews${q ? `?${q}` : ''}`
  );
}

export function listPodcastReviews(
  podcastId: string,
  options: { page?: number; limit?: number; q?: string; sort?: 'newest' | 'oldest' }
): Promise<AdminReviewsListResponse> {
  const params = new URLSearchParams();
  if (options.page != null) params.set('page', String(options.page));
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.q != null) params.set('q', options.q);
  if (options.sort != null) params.set('sort', options.sort);
  const qs = params.toString();
  return apiGet<AdminReviewsListResponse>(
    `/podcasts/${encodeURIComponent(podcastId)}/reviews${qs ? `?${qs}` : ''}`
  );
}

export function approveReview(podcastId: string, reviewId: string) {
  return apiPatch<{ ok: boolean }>(
    `/podcasts/${encodeURIComponent(podcastId)}/reviews/${encodeURIComponent(reviewId)}/approve`,
    {}
  );
}

/** Delete (hide) a review. Manager, owner, or admin only. */
export function deletePodcastReview(podcastId: string, reviewId: string) {
  return apiDelete<{ ok: boolean }>(
    `/podcasts/${encodeURIComponent(podcastId)}/reviews/${encodeURIComponent(reviewId)}`
  );
}

/** Delete (hide) a review. Requires auth; allowed only for review author or admin. */
export function deleteReview(reviewId: string) {
  return apiDelete<{ ok: boolean }>(
    `/public/reviews/${encodeURIComponent(reviewId)}`
  );
}
