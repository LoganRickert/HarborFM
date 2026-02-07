import { apiGet, apiPost } from './client';

export function setupStatus() {
  return apiGet<{ setupRequired: boolean; registrationEnabled: boolean; publicFeedsEnabled: boolean }>('/setup/status');
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
  }
) {
  const q = new URLSearchParams({ id });
  return apiPost<{ ok: true; user: { id: string; email: string; role: 'admin' } }>(
    `/setup/complete?${q.toString()}`,
    body
  );
}

