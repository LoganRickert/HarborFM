import { z } from 'zod';

/** Schema for admin PATCH user (update). All fields optional. */
export const userUpdateBodySchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['user', 'admin']).optional(),
  disabled: z.boolean().optional(),
  read_only: z.boolean().optional(),
  password: z.string().optional(),
  max_podcasts: z.number().int().min(0).nullable().optional(),
  max_episodes: z.number().int().min(0).nullable().optional(),
  max_storage_mb: z.number().int().min(0).nullable().optional(),
  max_collaborators: z.number().int().min(0).nullable().optional(),
});

export type UserUpdateBody = z.infer<typeof userUpdateBodySchema>;
