import { apiGet, apiPost } from './client';

export interface User {
  id: string;
  email: string;
  created_at?: string;
  role?: 'user' | 'admin';
  read_only?: number; // 0 = false, 1 = true
  max_podcasts?: number | null;
  max_episodes?: number | null;
  max_collaborators?: number | null;
  max_storage_mb?: number | null;
  max_api_keys?: number | null;
  disk_bytes_used?: number;
  can_transcribe?: number; // 0 = false, 1 = true
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
export const START_CALL_BLOCKED_STORAGE_MESSAGE = 'You are out of disk space';

export interface TwoFactorStatus {
  hasTOTP: boolean;
  hasEmail: boolean;
  methods: string | null;
}

export interface MeResponse {
  user: User;
  podcast_count: number;
  episode_count: number;
  twoFactor?: TwoFactorStatus | null;
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

export type LoginResponse =
  | { user: User }
  | { requires2FA: true; challengeToken: string; method: 'totp' | 'email' }
  | { requires2FASetup: true; challengeToken: string; methods: ('totp' | 'email')[] };

export function login(email: string, password: string, captchaToken?: string) {
  return apiPost<LoginResponse>('/auth/login', { email, password, ...(captchaToken ? { captchaToken } : {}) });
}

export function verify2FA(challengeToken: string, code: string) {
  return apiPost<{ user: User }>('/auth/2fa/verify', { challengeToken, code });
}

export function send2FAEmailCode(challengeToken: string) {
  return apiPost<{ ok: boolean }>('/auth/2fa/send-email-code', { challengeToken });
}

export function setup2FA(challengeToken: string, method: 'totp' | 'email') {
  return apiPost<{ qrDataUrl?: string; secret?: string; challengeToken?: string; ok?: boolean }>(
    '/auth/2fa/setup',
    { challengeToken, method }
  );
}

export function confirm2FASetup(challengeToken: string, code: string, secret?: string) {
  return apiPost<{ user: User }>('/auth/2fa/confirm-setup', { challengeToken, code, ...(secret ? { secret } : {}) });
}

export function logout() {
  return apiPost<{ ok: boolean }>('/auth/logout');
}

export function verifyEmail(token: string) {
  return apiGet<{ ok: boolean }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
}

export function validateResetToken(token: string) {
  return apiGet<{ ok: boolean; requiresTOTP?: boolean }>(
    `/auth/validate-reset-token?token=${encodeURIComponent(token)}`
  );
}

export function forgotPassword(email: string, captchaToken?: string) {
  return apiPost<{ ok: boolean }>('/auth/forgot-password', {
    email,
    ...(captchaToken ? { captchaToken } : {}),
  });
}

export function resetPassword(
  token: string,
  password: string,
  totpCode?: string
) {
  return apiPost<{ ok: boolean }>('/auth/reset-password', {
    token,
    password,
    ...(totpCode ? { totpCode } : {}),
  });
}

export function startTOTPSetup(password: string) {
  return apiPost<{ qrDataUrl: string; secret: string; setupToken: string }>(
    '/auth/me/2fa/totp/start',
    { password }
  );
}

export function confirmTOTPSetup(setupToken: string, code: string, secret: string) {
  return apiPost<{ ok: boolean }>('/auth/me/2fa/totp/confirm', {
    setupToken,
    code,
    secret,
  });
}

export function startEmail2FA() {
  return apiPost<{ ok: boolean }>('/auth/me/2fa/email/start');
}

export function confirmEmail2FA(code: string) {
  return apiPost<{ ok: boolean }>('/auth/me/2fa/email/confirm', { code });
}

export function disable2FA(password: string) {
  return apiPost<{ ok: boolean }>('/auth/me/2fa/disable', { password });
}
