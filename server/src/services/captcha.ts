/**
 * Server-side CAPTCHA token verification for reCAPTCHA v2, v3, and hCaptcha.
 */

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

export type CaptchaProvider = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';

export interface VerifyCaptchaResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify a CAPTCHA response token with the configured provider.
 */
export async function verifyCaptcha(
  provider: CaptchaProvider,
  secretKey: string,
  responseToken: string,
  remoteIp?: string
): Promise<VerifyCaptchaResult> {
  const token = (responseToken || '').trim();
  if (!token) {
    return { ok: false, error: 'Missing CAPTCHA response' };
  }
  if (!secretKey) {
    return { ok: false, error: 'CAPTCHA not configured' };
  }

  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  const url = provider === 'hcaptcha' ? HCAPTCHA_VERIFY_URL : RECAPTCHA_VERIFY_URL;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { ok: false, error: msg };
  }

  if (!res.ok) {
    return { ok: false, error: `Verification request failed: ${res.status}` };
  }

  let data: { success?: boolean; 'error-codes'?: string[]; score?: number };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, error: 'Invalid verification response' };
  }

  if (!data.success) {
    const codes = data['error-codes'] ?? [];
    const msg = codes.length ? codes.join(', ') : 'Verification failed';
    return { ok: false, error: msg };
  }

  // reCAPTCHA v3: optionally enforce a minimum score (e.g. 0.5). For now we accept any success.
  if (provider === 'recaptcha_v3' && typeof data.score === 'number' && data.score < 0.5) {
    return { ok: false, error: 'Score too low' };
  }

  return { ok: true };
}
