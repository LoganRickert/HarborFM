/**
 * True when the episode flag is on and "now" falls inside the optional start/end window.
 * - Flag off: never gated
 * - Flag on, no dates: always gated
 * - Start only: gated once start has been reached
 * - End only: gated until end
 * - Both: gated while start <= now < end
 */
export function isCurrentlySubscriberOnly(row: {
  subscriberOnly?: boolean | number | null;
  subscriberOnlyStartsAt?: string | null;
  subscriberOnlyEndsAt?: string | null;
}): boolean {
  const flag = row.subscriberOnly === true || row.subscriberOnly === 1;
  if (!flag) return false;
  const now = Date.now();
  const startsRaw = row.subscriberOnlyStartsAt;
  const endsRaw = row.subscriberOnlyEndsAt;
  const startsAt =
    typeof startsRaw === "string" && startsRaw.trim() !== ""
      ? new Date(startsRaw).getTime()
      : null;
  const endsAt =
    typeof endsRaw === "string" && endsRaw.trim() !== ""
      ? new Date(endsRaw).getTime()
      : null;
  if (startsAt != null && Number.isFinite(startsAt) && now < startsAt) return false;
  if (endsAt != null && Number.isFinite(endsAt) && now >= endsAt) return false;
  return true;
}
