import { apiGet, apiPost } from './client';

export type CastProfileUpdateFormState =
  | { state: 'invalid' }
  | {
      state: 'ok';
      podcastTitle: string;
      name: string;
      nickname: string | null;
      description: string | null;
      socialLinks: string[];
      timeZone: string | null;
      photoUrl: string | null;
      hasPending: boolean;
    };

export function getCastProfileUpdateForm(token: string) {
  const q = new URLSearchParams({ token });
  return apiGet<CastProfileUpdateFormState>(
    `/public/cast-profile-update?${q.toString()}`,
  );
}

export async function submitCastProfileUpdate(opts: {
  token: string;
  name: string;
  nickname: string;
  description: string;
  socialLinks: string[];
  timeZone?: string | null;
  photo?: File | null;
}): Promise<{ ok: boolean }> {
  if (opts.photo) {
    const form = new FormData();
    form.append('token', opts.token);
    form.append('name', opts.name);
    form.append('nickname', opts.nickname);
    form.append('description', opts.description);
    form.append('socialLinks', JSON.stringify(opts.socialLinks));
    form.append('timeZone', opts.timeZone ?? '');
    form.append('photo', opts.photo);
    const res = await fetch(`/api/public/cast-profile-update`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return res.json();
  }
  return apiPost<{ ok: boolean }>(`/public/cast-profile-update`, {
    token: opts.token,
    name: opts.name,
    nickname: opts.nickname || null,
    description: opts.description || null,
    socialLinks: opts.socialLinks,
    timeZone: opts.timeZone || null,
  });
}
