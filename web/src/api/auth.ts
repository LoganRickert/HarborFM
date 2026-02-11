import { apiGet, apiPost } from './client';

export interface User {
  id: string;
  email: string;
  created_at?: string;
  role?: 'user' | 'admin';
  read_only?: number; // 0 = false, 1 = true
  max_podcasts?: number | null;
  max_episodes?: number | null;
  max_storage_mb?: number | null;
  disk_bytes_used?: number;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  last_login_location?: string | null;
}

/** True if the user is in read-only mode (cannot create or edit content). */
export function isReadOnly(user: User | null | undefined): boolean {
  return Boolean(user?.read_only);
}

const FIVE_MB = 5 * 1024 * 1024;

/** True if the user can record a new section (has at least 5 MB free when they have a storage limit). */
export function canRecordNewSection(me: MeResponse | undefined): boolean {
  if (!me?.user) return true;
  return canRecordNewSectionFromUser(me.user);
}

/** Same as canRecordNewSection but takes the user object (e.g. from auth store). */
export function canRecordNewSectionFromUser(user: User | null | undefined): boolean {
  if (!user) return true;
  const maxMb = user.max_storage_mb ?? null;
  if (maxMb == null || maxMb <= 0) return true;
  const used = user.disk_bytes_used ?? 0;
  const limitBytes = maxMb * 1024 * 1024;
  const freeBytes = limitBytes - used;
  return freeBytes >= FIVE_MB;
}

export const RECORD_BLOCKED_STORAGE_MESSAGE = 'Less than 5 MB storage free. Free up space to record.';

export interface MeResponse {
  user: User;
  podcast_count: number;
  episode_count: number;
}

export function me() {
  return apiGet<MeResponse>('/auth/me');
}

export type RegisterResponse =
  | { user: User }
  | { requiresVerification: true; message: string };

export function register(email: string, password: string, captchaToken?: string) {
  return apiPost<RegisterResponse>('/auth/register', { email, password, ...(captchaToken ? { captchaToken } : {}) });
}

export function login(email: string, password: string, captchaToken?: string) {
  return apiPost<{ user: User }>('/auth/login', { email, password, ...(captchaToken ? { captchaToken } : {}) });
}

export function logout() {
  return apiPost<{ ok: boolean }>('/auth/logout');
}

export function verifyEmail(token: string) {
  return apiGet<{ ok: boolean }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
}

export function validateResetToken(token: string) {
  return apiGet<{ ok: boolean }>(`/auth/validate-reset-token?token=${encodeURIComponent(token)}`);
}

export function forgotPassword(email: string) {
  return apiPost<{ ok: boolean }>('/auth/forgot-password', { email });
}

export function resetPassword(token: string, password: string) {
  return apiPost<{ ok: boolean }>('/auth/reset-password', { token, password });
}
