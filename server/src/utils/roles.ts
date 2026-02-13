/** Share roles used for permission thresholds (view < editor < manager < owner). */
const SHARE_ROLES = ["view", "editor", "manager", "owner"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

/**
 * Parse a string into a valid ShareRole, or return the default.
 * Case-insensitive; trims whitespace.
 */
export function parseShareRole(
  value: string | undefined,
  defaultValue: ShareRole,
): ShareRole {
  const v = value?.trim()?.toLowerCase();
  return v && SHARE_ROLES.includes(v as ShareRole)
    ? (v as ShareRole)
    : defaultValue;
}
