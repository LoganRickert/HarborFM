import { eq } from "drizzle-orm";
import { drizzleDb } from "../../db/index.js";
import { podcastShares, podcasts, users } from "../../db/schema.js";
import {
  buildCastProfileApprovedEmail,
  buildCastProfilePendingNotifyEmail,
  sendMail,
} from "../../services/email.js";
import { canAddEditGuest, canAddEditHost } from "../../services/access.js";
import { absoluteOrigin } from "../call/meetingMail.js";
import type { CastProfileCastContext } from "./repo.js";

function collectEditorEmails(opts: {
  podcastId: string;
  castRole: "host" | "guest";
}): string[] {
  const emails = new Set<string>();
  const owner = drizzleDb
    .select({ email: users.email })
    .from(podcasts)
    .innerJoin(users, eq(podcasts.ownerUserId, users.id))
    .where(eq(podcasts.id, opts.podcastId))
    .limit(1)
    .get();
  if (owner?.email?.trim()) emails.add(owner.email.trim().toLowerCase());

  const shares = drizzleDb
    .select({
      email: users.email,
      role: podcastShares.role,
    })
    .from(podcastShares)
    .innerJoin(users, eq(podcastShares.userId, users.id))
    .where(eq(podcastShares.podcastId, opts.podcastId))
    .all() as { email: string | null; role: string }[];

  for (const share of shares) {
    const email = share.email?.trim();
    if (!email) continue;
    const canEdit =
      opts.castRole === "host"
        ? canAddEditHost(share.role)
        : canAddEditGuest(share.role);
    if (canEdit) {
      emails.add(email.toLowerCase());
    }
  }

  return [...emails];
}

export async function notifyHostsOfCastProfilePending(opts: {
  cast: CastProfileCastContext;
  fallbackOrigin: string;
}): Promise<void> {
  const origin = absoluteOrigin(opts.fallbackOrigin);
  const manageUrl = `${origin}/podcasts/${encodeURIComponent(opts.cast.podcastId)}`;
  const content = buildCastProfilePendingNotifyEmail({
    castName: opts.cast.name,
    podcastTitle: opts.cast.podcastTitle,
    manageUrl,
    baseUrl: origin,
  });
  const recipients = collectEditorEmails({
    podcastId: opts.cast.podcastId,
    castRole: opts.cast.role,
  });
  await Promise.all(
    recipients.map((to) =>
      sendMail({
        to,
        ...content,
      }),
    ),
  );
}

export async function notifyCastOfProfileApproved(opts: {
  castName: string;
  castEmail: string | null | undefined;
  podcastTitle: string;
  fallbackOrigin: string;
}): Promise<void> {
  const to = opts.castEmail?.trim();
  if (!to) return;
  const origin = absoluteOrigin(opts.fallbackOrigin);
  const content = buildCastProfileApprovedEmail({
    castName: opts.castName,
    podcastTitle: opts.podcastTitle,
    baseUrl: origin,
  });
  await sendMail({ to, ...content });
}
