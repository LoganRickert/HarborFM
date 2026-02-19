import { z } from 'zod';

/** Body for POST /call/start. */
export const callStartBodySchema = z.object({
  episodeId: z.string().min(1, { message: 'episodeId is required' }),
  password: z.string().optional().nullable(),
});

/** Params for routes using :code (e.g. GET /call/join/:code). */
export const callSessionCodeParamSchema = z.object({
  code: z.string().min(1, { message: 'Join code is required' }),
});

/** Params for routes using :token (e.g. GET /call/session, GET /call/join/:token). */
export const callSessionTokenParamSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
});

/** Query for GET /call/session (episodeId). */
export const callSessionQuerySchema = z.object({
  episodeId: z.string().min(1, { message: 'episodeId is required' }),
});

export type CallStartBody = z.infer<typeof callStartBodySchema>;
export type CallSessionCodeParam = z.infer<typeof callSessionCodeParamSchema>;
export type CallSessionTokenParam = z.infer<typeof callSessionTokenParamSchema>;
export type CallSessionQuery = z.infer<typeof callSessionQuerySchema>;

/** Params for DELETE /bans/:ip (admin unban). */
export const bansIpParamSchema = z.object({
  ip: z.string().min(1, { message: "IP is required" }).max(45),
});
export type BansIpParam = z.infer<typeof bansIpParamSchema>;
