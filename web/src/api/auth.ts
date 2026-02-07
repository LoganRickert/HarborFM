import { apiGet, apiPost } from './client';

export interface User {
  id: string;
  email: string;
  role?: 'user' | 'admin';
}

export interface MeResponse {
  user: User;
}

export function me() {
  return apiGet<MeResponse>('/auth/me');
}

export function register(email: string, password: string) {
  return apiPost<{ user: User }>('/auth/register', { email, password });
}

export function login(email: string, password: string) {
  return apiPost<{ user: User }>('/auth/login', { email, password });
}

export function logout() {
  return apiPost<{ ok: boolean }>('/auth/logout');
}
