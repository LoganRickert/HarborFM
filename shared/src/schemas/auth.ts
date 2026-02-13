import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }),
  captchaToken: z.string().optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, { error: 'Password is required' }),
  captchaToken: z.string().optional(),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().min(1, { error: 'Email is required' }).email(),
  captchaToken: z.string().optional(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, { error: 'Token is required' }),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }),
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
export const authApiKeyCreateBodySchema = z.object({
  name: z.string().optional(),
  valid_until: z.string().optional(),
  valid_from: z.string().optional(),
});

/** Body for PATCH api-keys/:id (update). */
export const authApiKeyUpdateBodySchema = z.object({
  name: z.string().optional(),
  valid_until: z.string().optional(),
  valid_from: z.string().optional(),
  disabled: z.boolean().optional(),
});

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
