/**
 * HarborFM entity ids are default nanoid() values: 21 URL-safe chars.
 * Used to reject tampered project/archive metadata (e.g. "thisisanidtest").
 */
export const HARBOR_ENTITY_ID_LENGTH = 21;

const HARBOR_ENTITY_ID_RE = /^[A-Za-z0-9_-]{21}$/;

/** True when `id` matches a default HarborFM nanoid entity id. */
export function isHarborEntityId(id: unknown): id is string {
  return typeof id === "string" && HARBOR_ENTITY_ID_RE.test(id);
}
