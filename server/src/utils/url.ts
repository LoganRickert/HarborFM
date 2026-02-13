/**
 * Trims whitespace and removes trailing slashes. Used for hostnames, pathnames, and URL-like strings.
 */
export function normalizeHostname(input: string): string {
  let v = input.trim();
  if (!v) return "";
  while (v.endsWith("/")) {
    v = v.slice(0, -1);
  }
  return v;
}
