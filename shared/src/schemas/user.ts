import { z } from 'zod';

const optionalLimitField = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.number().int().min(0).nullable().optional()
);

/** Schema for admin POST user (create). */
export const userCreateBodySchema = z.object({
  email: z.string().min(1, { error: 'Valid email is required' }).email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, { error: 'Password must be at least 8 characters' }),
  role: z.enum(['user', 'admin']).optional().default('user'),
});

/** Schema for admin PATCH user (update). All fields optional. Accepts '' for limit fields (coerced to undefined). */
export const userUpdateBodySchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['user', 'admin']).optional(),
  disabled: z.boolean().optional(),
  read_only: z.boolean().optional(),
  password: z.string().optional().transform((s) => (s != null && s.trim() !== '' ? s : undefined)),
  max_podcasts: optionalLimitField,
  max_episodes: optionalLimitField,
  max_storage_mb: optionalLimitField,
  max_collaborators: optionalLimitField,
  max_subscriber_tokens: optionalLimitField,
  can_transcribe: z.boolean().optional(),
});

export type UserCreateBody = z.infer<typeof userCreateBodySchema>;
export type UserUpdateBody = z.infer<typeof userUpdateBodySchema>;
