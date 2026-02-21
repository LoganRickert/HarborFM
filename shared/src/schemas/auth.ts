import { z } from 'zod';
import { IMPLEMENTED_METHOD_IDS } from '../constants/twoFactor.js';
import { USERNAME_REGEX } from '../constants/username.js';

/** Optional ISO 8601 datetime; empty string treated as undefined. */
const optionalIsoDatetime = z
  .string()
  .optional()
  .refine(
    (v) => !v || v.trim() === '' || !Number.isNaN(new Date(v.trim()).getTime()),
    { message: 'Must be a valid ISO 8601 datetime' },
  )
  .transform((v) => (v?.trim() || undefined));

export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }).max(256),
  captchaToken: z.string().optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, { error: 'Password is required' }).max(256),
  captchaToken: z.string().optional(),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().min(1, { error: 'Email is required' }).email(),
  captchaToken: z.string().optional(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, { error: 'Token is required' }),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }).max(256),
  totpCode: z.string().optional(), // Required when user has TOTP enabled
});

/** Query for GET verify-email and GET reset-password/check (token in query). */
export const authTokenQuerySchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
});

/** Body for POST invite (platform invite by email). */
export const authInviteBodySchema = z.object({
  email: z.string().email({ message: 'Valid email is required' }),
});

/** Body for POST api-keys (create). */
export const authApiKeyCreateBodySchema = z
  .object({
    name: z.string().optional(),
    validUntil: optionalIsoDatetime,
    validFrom: optionalIsoDatetime,
  })
  .refine(
    (data) => {
      const from = data.validFrom;
      const to = data.validUntil;
      if (!from || !to) return true;
      return new Date(from).getTime() <= new Date(to).getTime();
    },
    { message: 'validFrom must be before or equal to validUntil', path: ['validFrom'] },
  );

/** Body for PATCH api-keys/:id (update). */
export const authApiKeyUpdateBodySchema = z
  .object({
    name: z.string().optional(),
    validUntil: optionalIsoDatetime,
    validFrom: optionalIsoDatetime,
    disabled: z.boolean().optional(),
  })
  .refine(
    (data) => {
      const from = data.validFrom;
      const to = data.validUntil;
      if (!from || !to) return true;
      return new Date(from).getTime() <= new Date(to).getTime();
    },
    { message: 'validFrom must be before or equal to validUntil', path: ['validFrom'] },
  );

/** Params for api-keys/:id (get, patch, revoke). */
export const authApiKeyIdParamSchema = z.object({
  id: z.string().min(1),
});

/** Query for GET api-keys (list). */
export const authApiKeyListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
});

/** Body for POST auth/2fa/verify (TOTP or email code). Challenge comes from HttpOnly cookie. */
export const verify2FABodySchema = z.object({
  challengeToken: z.string().optional(),
  code: z.string().min(1, { message: 'Code is required' }),
});

/** Body for POST auth/2fa/send-email-code. Challenge comes from HttpOnly cookie. */
export const send2FAEmailCodeBodySchema = z.object({
  challengeToken: z.string().optional(),
});

/** Body for POST auth/2fa/setup (start 2FA setup). Challenge comes from HttpOnly cookie. */
export const setup2FABodySchema = z.object({
  challengeToken: z.string().optional(),
  method: z.enum(IMPLEMENTED_METHOD_IDS as [string, ...string[]]),
});

/** Body for POST auth/2fa/confirm-setup (confirm TOTP or email). Challenge comes from HttpOnly cookie. */
export const confirm2FASetupBodySchema = z.object({
  challengeToken: z.string().optional(),
  code: z.string().min(1, { message: 'Code is required' }),
  secret: z.string().optional(), // Required for TOTP setup (client received from /setup)
});

/** Body for POST auth/me/2fa/totp/confirm (profile TOTP setup). */
export const totpConfirmBodySchema = z.object({
  setupToken: z.string().min(1, { message: 'Setup token is required' }).max(256),
  code: z.string().min(6, { message: 'Code must be at least 6 characters' }).max(10),
  secret: z.string().min(1, { message: 'Secret is required' }).max(64),
});

/** Body for POST auth/complete-account (set email and/or username after SSO). */
export const completeAccountBodySchema = z
  .object({
    email: z.string().optional(),
    username: z.string().optional(),
  })
  .refine(
    (data) => {
      const e = (data.email ?? '').trim();
      const u = (data.username ?? '').trim();
      return e !== '' || u !== '';
    },
    { message: 'Provide at least one of email or username.' },
  )
  .refine(
    (data) => {
      const e = (data.email ?? '').trim();
      if (e === '') return true;
      return z.string().email().safeParse(e).success;
    },
    { message: 'Invalid email.', path: ['email'] },
  )
  .refine(
    (data) => {
      const u = (data.username ?? '').trim();
      if (u === '') return true;
      return u.length >= 6 && USERNAME_REGEX.test(u);
    },
    { message: 'Username must be at least 6 characters and only contain letters, numbers, and underscores.', path: ['username'] },
  );

/** Body for POST auth/me/profile/update (password, 2FA code, email, username). */
export const profileUpdateBodySchema = z.object({
  password: z.string().optional(),
  challengeToken: z.string().optional(),
  code: z.string().optional(),
  email: z.string().email().optional(),
  username: z.string().min(6).regex(USERNAME_REGEX).optional(),
});

/** Body for POST auth/me/2fa/disable (password required, optional code if TOTP). */
export const twoFactorDisableBodySchema = z.object({
  password: z.string().min(1, { message: 'Password is required' }),
  code: z.string().optional(),
});

/** Body for POST auth/me/2fa/totp/setup (password required, optional code if 2FA enabled). */
export const twoFactorTotpSetupBodySchema = z.object({
  password: z.string().min(1, { message: 'Password is required' }),
  code: z.string().optional(),
});

/** Body for POST auth/me/disable-account (password optional for federated users). */
export const disableAccountBodySchema = z.object({
  password: z.string().optional(),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type AuthTokenQuery = z.infer<typeof authTokenQuerySchema>;
export type AuthInviteBody = z.infer<typeof authInviteBodySchema>;
export type AuthApiKeyCreateBody = z.infer<typeof authApiKeyCreateBodySchema>;
export type AuthApiKeyUpdateBody = z.infer<typeof authApiKeyUpdateBodySchema>;
export type AuthApiKeyIdParam = z.infer<typeof authApiKeyIdParamSchema>;
export type AuthApiKeyListQuery = z.infer<typeof authApiKeyListQuerySchema>;
export type Verify2FABody = z.infer<typeof verify2FABodySchema>;
export type Send2FAEmailCodeBody = z.infer<typeof send2FAEmailCodeBodySchema>;
export type Setup2FABody = z.infer<typeof setup2FABodySchema>;
export type Confirm2FASetupBody = z.infer<typeof confirm2FASetupBodySchema>;
export type TotpConfirmBody = z.infer<typeof totpConfirmBodySchema>;
export type CompleteAccountBody = z.infer<typeof completeAccountBodySchema>;
export type ProfileUpdateBody = z.infer<typeof profileUpdateBodySchema>;
export type TwoFactorDisableBody = z.infer<typeof twoFactorDisableBodySchema>;
export type TwoFactorTotpSetupBody = z.infer<typeof twoFactorTotpSetupBodySchema>;
export type DisableAccountBody = z.infer<typeof disableAccountBodySchema>;
