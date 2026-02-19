import type { UserCreateBody, UserUpdateBody } from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

export interface FederatedIdentity {
  providerType: string;
  issuer: string;
  providerName?: string;
}

export interface User {
  id: string;
  email: string | null;
  username?: string | null;
  createdAt: string;
  role: 'user' | 'admin';
  disabled: number; // 0 = false, 1 = true
  readOnly?: number; // 0 = false, 1 = true
  diskBytesUsed: number; // bytes
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  lastLoginLocation?: string | null;
  maxPodcasts?: number | null;
  maxEpisodes?: number | null;
  maxStorageMb?: number | null;
  maxCollaborators?: number | null;
  maxSubscriberTokens?: number | null;
  canTranscribe?: number; // 0 = false, 1 = true
  federatedIdentities?: FederatedIdentity[];
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

export function updateUser(userId: string, data: UserUpdateBody): Promise<User> {
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

export function createUser(data: UserCreateBody): Promise<User> {
  return fetch(`${BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify({
      email: data.email,
      password: data.password,
      role: data.role ?? 'user',
    }),
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
