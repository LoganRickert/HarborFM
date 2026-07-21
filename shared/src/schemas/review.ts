import { z } from 'zod';

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_BODY_LENGTH = 5000;
const MIN_BODY_LENGTH = 10;

export const reviewSubmitBodySchema = z.object({
  podcastSlug: z.string().min(1, { message: 'Podcast is required' }).transform((s) => s.trim()),
  episodeSlug: z.string().optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
  name: z.string().min(1, { message: 'Please provide a name' }).max(MAX_NAME_LENGTH).transform((s) => s.trim()),
  email: z.string().max(MAX_EMAIL_LENGTH).email({ message: 'Please provide a valid email address' }).optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
  rating: z.number().int().min(1).max(5),
  body: z.string().min(MIN_BODY_LENGTH, { message: `Review must be at least ${MIN_BODY_LENGTH} characters` }).max(MAX_BODY_LENGTH).transform((s) => s.trim()),
  captchaToken: z.string().optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
});

export type ReviewSubmitBody = z.infer<typeof reviewSubmitBodySchema>;

export type PublicReviewDto = {
  id: string;
  name: string;
  rating: number;
  body: string;
  verified: boolean;
  createdAt: string;
  episodeTitle?: string | null;
  /** True if the current user can delete this review (author or admin). Set by server only. */
  canDelete?: boolean;
};

export type ReviewsListResponse = {
  reviews: PublicReviewDto[];
  hasMore: boolean;
};

export type AdminReviewDto = {
  id: string;
  podcastId: string;
  episodeId: string | null;
  name: string;
  email: string;
  rating: number;
  body: string;
  verified: boolean;
  approved: boolean;
  spam: boolean;
  hidden: boolean;
  createdAt: string;
  episodeTitle: string | null;
};

export type AdminReviewsListResponse = {
  reviews: AdminReviewDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
