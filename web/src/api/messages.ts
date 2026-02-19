import { apiGet } from './client';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  podcastId?: string | null;
  episodeId?: string | null;
  podcastTitle?: string | null;
  episodeTitle?: string | null;
}

export interface MessagesResponse {
  messages: ContactMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type MessagesSort = 'newest' | 'oldest';

export function listMessages(
  page: number = 1,
  limit: number = 50,
  search?: string,
  sort?: MessagesSort
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search) params.set('search', search);
  if (sort) params.set('sort', sort);
  return apiGet<MessagesResponse>(`/messages?${params.toString()}`);
}
