const BASE = '/api';

const CSRF_COOKIE_NAME = 'harborfm_csrf';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const parts = document.cookie.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    if (k !== name) continue;
    const v = part.slice(eq + 1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return undefined;
}

export function getCsrfToken(): string | undefined {
  return readCookie(CSRF_COOKIE_NAME);
}

export function csrfHeaders(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'x-csrf-token': token } : {};
}

function isUnsafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

export async function api<T>(
  path: string,
  opts: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...init } = opts;
  const method = (init.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers: HeadersInit = {
    ...(init.headers as Record<string, string>),
  };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (isUnsafeMethod(method)) {
    Object.assign(headers as Record<string, string>, csrfHeaders());
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    method,
    credentials: 'include',
    headers,
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const msg =
        retryAfter && /^\d+$/.test(retryAfter)
          ? `Too many requests. Please try again in ${retryAfter} second${retryAfter === '1' ? '' : 's'}.`
          : 'Too many requests. Please wait a moment and try again.';
      throw new Error(msg);
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string) {
  return api<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, json?: unknown) {
  return api<T>(path, { method: 'POST', json });
}

export function apiPatch<T>(path: string, json: unknown) {
  return api<T>(path, { method: 'PATCH', json });
}

export function apiPut<T>(path: string, json: unknown) {
  return api<T>(path, { method: 'PUT', json });
}

export function apiDelete<T>(path: string) {
  return api<T>(path, { method: 'DELETE' });
}
