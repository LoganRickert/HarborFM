import { apiGet, apiPost } from './client';

export type CaptchaProvider = 'none' | 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';

export function setupStatus() {
  return apiGet<{
    setupRequired: boolean;
    registrationEnabled: boolean;
    publicFeedsEnabled: boolean;
    captchaProvider: CaptchaProvider;
    captchaSiteKey: string;
    emailConfigured: boolean;
  }>('/setup/status');
}

export function validateSetupId(id: string) {
  const q = new URLSearchParams({ id });
  return apiGet<{ ok: true }>(`/setup/validate?${q.toString()}`);
}

export function completeSetup(
  id: string,
  body: {
    email: string;
    password: string;
    hostname: string;
    registration_enabled: boolean;
    public_feeds_enabled: boolean;
    import_pixabay_assets?: boolean;
  }
) {
  const q = new URLSearchParams({ id });
  return apiPost<{ ok: true; user: { id: string; email: string; role: 'admin' } }>(
    `/setup/complete?${q.toString()}`,
    body
  );
}

