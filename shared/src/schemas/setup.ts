import { z } from 'zod';

/** Query for GET /setup/check and POST /setup/complete (setup token). */
export const setupTokenQuerySchema = z.object({
  id: z.string().min(1, { message: 'Missing setup id' }),
});

/** Body for POST /setup/complete. */
export const setupCompleteBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  hostname: z.string().optional(),
  registration_enabled: z.boolean().optional(),
  public_feeds_enabled: z.boolean().optional(),
  import_pixabay_assets: z.boolean().optional(),
});

export type SetupTokenQuery = z.infer<typeof setupTokenQuerySchema>;
export type SetupCompleteBody = z.infer<typeof setupCompleteBodySchema>;
