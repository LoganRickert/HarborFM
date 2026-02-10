import { isbot } from 'isbot';

/**
 * Treats the request as human only when we have a non-empty UA and it's not a known bot.
 * Missing or empty UA defaults to bot (conservative).
 */
export function isHumanUserAgent(userAgent: string): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return false;
  return !isbot(ua);
}
