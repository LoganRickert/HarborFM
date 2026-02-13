import { z } from 'zod';

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_MESSAGE_LENGTH = 10000;

export const contactBodySchema = z.object({
  name: z.string().min(1, { error: 'Please provide a valid name' }).max(MAX_NAME_LENGTH, { error: `Name must be at most ${MAX_NAME_LENGTH} characters` }).transform((s) => s.trim()),
  email: z.string().min(1, { error: 'Please provide a valid email address' }).max(MAX_EMAIL_LENGTH).email({ error: 'Please provide a valid email address' }).transform((s) => s.trim()),
  message: z.string().min(1, { error: 'Please provide a message' }).max(MAX_MESSAGE_LENGTH, { error: `Message must be at most ${MAX_MESSAGE_LENGTH} characters` }).transform((s) => s.trim()),
  captchaToken: z.string().optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
  podcastSlug: z.string().optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
  episodeSlug: z.string().optional().transform((s) => (s != null && s !== '' ? s.trim() : undefined)),
});

export type ContactBody = z.infer<typeof contactBodySchema>;
