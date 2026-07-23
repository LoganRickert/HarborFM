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

/** Guest-facing meeting join status for scheduled meetings. */
export const callMeetingStatusSchema = z.enum([
  'too_early',
  'waiting_for_host',
  'live',
  'ended',
  'expired',
  'cancelled',
]);
export type CallMeetingStatus = z.infer<typeof callMeetingStatusSchema>;

/** IANA time zone from the host browser (e.g. America/New_York). */
export const callMeetingTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_+/-]+$/, { message: 'Invalid time zone' });

/** Body for POST /call/meetings. */
export const callMeetingCreateBodySchema = z.object({
  episodeId: z.string().min(1, { message: 'episodeId is required' }),
  scheduledStartAt: z.string().min(1, { message: 'scheduledStartAt is required' }),
  timeZone: callMeetingTimeZoneSchema.optional(),
});
export type CallMeetingCreateBody = z.infer<typeof callMeetingCreateBodySchema>;

/** Body for PATCH /call/meetings/:id. */
export const callMeetingPatchBodySchema = z.object({
  scheduledStartAt: z.string().min(1, { message: 'scheduledStartAt is required' }),
  timeZone: callMeetingTimeZoneSchema.optional(),
});
export type CallMeetingPatchBody = z.infer<typeof callMeetingPatchBodySchema>;

/** Query for GET /call/meetings. */
export const callMeetingQuerySchema = z.object({
  episodeId: z.string().min(1, { message: 'episodeId is required' }),
});
export type CallMeetingQuery = z.infer<typeof callMeetingQuerySchema>;

/** Params for /call/meetings/:id. */
export const callMeetingIdParamSchema = z.object({
  id: z.string().min(1, { message: 'Meeting id is required' }),
});
export type CallMeetingIdParam = z.infer<typeof callMeetingIdParamSchema>;

/** Body for POST /call/meetings/:id/invites. */
export const callMeetingInviteBodySchema = z
  .object({
    name: z.string().max(120).optional().nullable(),
    email: z.string().email({ message: 'Valid email is required' }).optional().nullable(),
    /** Optional; fills in host time zone when the meeting was created without one. */
    timeZone: callMeetingTimeZoneSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const email = val.email?.trim() ?? '';
    const name = val.name?.trim() ?? '';
    if (!email && !name) {
      // Blank name + no email is allowed (generic share uses meeting join URL).
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Valid email is required',
        path: ['email'],
      });
    }
  });
export type CallMeetingInviteBody = z.infer<typeof callMeetingInviteBodySchema>;

/** Params for DELETE /call/meetings/:id/invites/:inviteId. */
export const callMeetingInviteIdParamSchema = z.object({
  id: z.string().min(1, { message: 'Meeting id is required' }),
  inviteId: z.string().min(1, { message: 'Invite id is required' }),
});
export type CallMeetingInviteIdParam = z.infer<typeof callMeetingInviteIdParamSchema>;

/** Query for invite name lookup on join page. */
export const callJoinInviteQuerySchema = z.object({
  invite: z.string().min(1).optional(),
});
export type CallJoinInviteQuery = z.infer<typeof callJoinInviteQuerySchema>;
