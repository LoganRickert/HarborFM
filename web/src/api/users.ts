import { csrfHeaders } from './client';

const BASE = '/api';

export interface User {
  id: string;
  email: string;
  created_at: string;
  role: 'user' | 'admin';
  disabled: number; // 0 = false, 1 = true
  disk_bytes_used: number; // bytes
  last_login_at?: string | null;
  last_login_ip?: string | null;
  last_login_location?: string | null;
}

export interface UsersResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function listUsers(page: number = 1, limit: number = 50, search?: string): Promise<UsersResponse> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search) params.set('search', search);
  return fetch(`${BASE}/users?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function getUser(userId: string): Promise<User> {
  return fetch(`${BASE}/users/${userId}`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function updateUser(userId: string, data: { email?: string; role?: 'user' | 'admin'; disabled?: boolean; password?: string }): Promise<User> {
  return fetch(`${BASE}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(data),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}

export function deleteUser(userId: string): Promise<{ success: boolean }> {
  return fetch(`${BASE}/users/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return r.json().then((err: { error?: string }) => { throw new Error(err.error ?? r.statusText); });
    return r.json();
  });
}
