import { apiPost } from './client';

export function submitContact(body: {
  name: string;
  email: string;
  message: string;
  captchaToken?: string;
  podcastSlug?: string;
  episodeSlug?: string;
}) {
  return apiPost<{ ok: boolean }>('/contact', body);
}
