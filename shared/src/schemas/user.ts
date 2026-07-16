import { z } from 'zod';
import {
  USERNAME_REGEX,
  USERNAME_MIN_LENGTH,
  USERNAME_MIN_LENGTH_ERROR,
  USERNAME_PATTERN_ERROR,
} from '../constants/username.js';

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
  username: z
    .union([
      z
        .string()
        .min(USERNAME_MIN_LENGTH, { message: USERNAME_MIN_LENGTH_ERROR })
        .regex(USERNAME_REGEX, { message: USERNAME_PATTERN_ERROR }),
      z.null(),
    ])
    .optional(),
  role: z.enum(['user', 'admin']).optional(),
  disabled: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  password: z.string().optional().transform((s) => (s != null && s.trim() !== '' ? s : undefined)),
  maxPodcasts: optionalLimitField,
  maxEpisodes: optionalLimitField,
  maxStorageMb: optionalLimitField,
  maxCollaborators: optionalLimitField,
  maxSubscriberTokens: optionalLimitField,
  canTranscribe: z.boolean().optional(),
  canGenerateVideo: z.boolean().optional(),
  canStripe: z.boolean().optional(),
  canEpisodeAlert: z.boolean().optional(),
});

export type UserCreateBody = z.infer<typeof userCreateBodySchema>;
export type UserUpdateBody = z.infer<typeof userUpdateBodySchema>;
