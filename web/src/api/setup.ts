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
    welcomeBanner: string;
    twoFactorEnabled: boolean;
    twoFactorEnforced: boolean;
    twoFactorMethods: string;
    emailSigninDisabled?: boolean;
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
    registrationEnabled: boolean;
    publicFeedsEnabled: boolean;
    importPixabayAssets?: boolean;
  }
) {
  const q = new URLSearchParams({ id });
  return apiPost<{ ok: true; user: { id: string; email: string; role: 'admin' } }>(
    `/setup/complete?${q.toString()}`,
    body
  );
}

