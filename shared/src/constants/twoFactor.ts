/**
 * Two-factor authentication method definitions.
 * Add new methods here when implementing SMS, voice call, etc.
 */
export const TWO_FACTOR_METHODS = [
  {
    id: 'totp',
    label: 'TOTP (Authenticator app)',
    shortLabel: 'Authenticator app (TOTP)',
    description:
      'Works with Authy, Microsoft Authenticator, 1Password, Google Authenticator, and other standard TOTP apps.',
    /** Provider required for this method (e.g. "email" needs SMTP/SendGrid). null = no extra provider. */
    requiresProvider: null as string | null,
  },
  {
    id: 'email',
    label: 'Email OTP',
    shortLabel: 'Email codes',
    description: 'Users receive a one-time code by email when signing in.',
    requiresProvider: 'email',
  },
  // Future: { id: 'sms', label: 'SMS', shortLabel: 'SMS codes', description: '...', requiresProvider: 'sms' },
  // Future: { id: 'call', label: 'Voice call', shortLabel: 'Phone call', description: '...', requiresProvider: 'call' },
] as const;

export type TwoFactorMethodId = (typeof TWO_FACTOR_METHODS)[number]['id'];

export const IMPLEMENTED_METHOD_IDS: TwoFactorMethodId[] = TWO_FACTOR_METHODS.map((m) => m.id);

/** Parse comma-separated two_factor_methods string to lowercase array. */
export function parseTwoFactorMethods(str: string | null | undefined): string[] {
  if (str == null || typeof str !== 'string') return [];
  return str
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

/** Serialize method array to comma-separated string. */
export function serializeTwoFactorMethods(methods: string[]): string {
  const unique = [...new Set(methods.map((m) => m.trim().toLowerCase()).filter(Boolean))];
  return unique.join(',') || 'totp';
}

/** Check if a method is in the allowed list. */
export function isMethodAllowed(allowedMethods: string[], methodId: string): boolean {
  return allowedMethods.includes(methodId.toLowerCase());
}
