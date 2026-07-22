/**
 * Build a tel: URI for phone dial-in. Optionally append pauses + join-code DTMF
 * so mobile can dial and enter the IVR code after the welcome prompt.
 */

/** Normalize a display phone number to a tel: number part (e.g. +15134404916). */
export function phoneToTelNumber(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const wantsPlus =
    trimmed.includes("+") || digits.length >= 11 || digits.length === 10;
  if (wantsPlus) {
    // US 10-digit: assume +1 when no country code present.
    if (digits.length === 10) return `+1${digits}`;
    return `+${digits}`;
  }
  return digits;
}

/**
 * tel: href that dials the number, waits for answer/IVR welcome, then sends
 * the 4-digit join code as DTMF (comma = pause on iOS/Android).
 */
export function dialInTelHref(
  phone: string,
  joinCode?: string | null,
): string | null {
  const number = phoneToTelNumber(phone);
  if (!number) return null;
  const code = (joinCode ?? "").replace(/\D/g, "");
  if (code.length !== 4) return `tel:${number}`;
  // Two pauses (~1–2s each on many phones) so the call can answer; the IVR
  // gather accepts DTMF during the welcome, so a long wait is not needed.
  return `tel:${number},,${code}`;
}
