import {
  FEED_THEME_ZIP_MAX_BYTES,
  HARBORFM_OFFICIAL_THEME_CATALOG_URL,
  type FeedBuiltinThemeListItem,
  type FeedBuiltinThemesListResponse,
  type FeedThemeDetail,
  type FeedThemeListItem,
  type FeedThemePatch,
  type FeedThemesListResponse,
  type ThemeBuiltinUpdateResponse,
  type ThemeCatalogBrowseResponse,
  type ThemeCatalogDestination,
  type ThemeCatalogDestinationsResponse,
  type ThemeCatalogInstallResponse,
  type ThemeCatalogThemeEntry,
} from '@harborfm/shared';
import { csrfHeaders } from './client';

const BASE = '/api';

export { FEED_THEME_ZIP_MAX_BYTES, HARBORFM_OFFICIAL_THEME_CATALOG_URL };

export type ThemeListItem = FeedThemeListItem;
export type BuiltinThemeListItem = FeedBuiltinThemeListItem;
export type ThemeDetail = FeedThemeDetail;
export type ThemePatch = FeedThemePatch;
export type ThemeDestination = ThemeCatalogDestination;
export type ThemeCatalogEntry = ThemeCatalogThemeEntry;

function toThemeListItem(r: Record<string, unknown>): ThemeListItem {
  return {
    id: String(r.id ?? ''),
    packageId: String(r.packageId ?? r.package_id ?? ''),
    name: String(r.name ?? ''),
    version: String(r.version ?? ''),
    description: String(r.description ?? ''),
    byteSize: Number(r.byteSize ?? r.byte_size ?? 0),
    createdAt: String(r.createdAt ?? r.created_at ?? ''),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
  };
}

export function listThemes(): Promise<{ themes: ThemeListItem[] }> {
  return fetch(`${BASE}/themes`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return r.json().then((data: FeedThemesListResponse) => ({
      themes: (data.themes ?? []).map((t) =>
        toThemeListItem(t as unknown as Record<string, unknown>),
      ),
    }));
  });
}

export function listBuiltinThemes(): Promise<{ builtins: BuiltinThemeListItem[] }> {
  return fetch(`${BASE}/themes/builtins`, { method: 'GET', credentials: 'include' }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return r.json().then((data: FeedBuiltinThemesListResponse) => ({
      builtins: data.builtins ?? [],
    }));
  });
}

async function downloadThemeZip(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? res.statusText);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function downloadBuiltinTheme(builtinId: string): Promise<void> {
  return downloadThemeZip(
    `${BASE}/themes/builtins/${encodeURIComponent(builtinId)}/download`,
    `${builtinId}-theme.zip`,
  );
}

export function downloadUserTheme(themeId: string): Promise<void> {
  return downloadThemeZip(
    `${BASE}/themes/${encodeURIComponent(themeId)}/download`,
    `${themeId}-theme.zip`,
  );
}
export function importTheme(file: File): Promise<{
  id: string;
  packageId?: string;
  name?: string;
  updated?: boolean;
  fromBuiltin?: boolean;
}> {
  const form = new FormData();
  form.append('file', file);
  return fetch(`${BASE}/themes/import`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
    body: form,
  }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return r.json();
  });
}

export function deleteTheme(id: string): Promise<void> {
  return fetch(`${BASE}/themes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return undefined;
  });
}

export function deleteServerTheme(builtinId: string): Promise<void> {
  return fetch(`${BASE}/themes/builtins/${encodeURIComponent(builtinId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) {
      return r.json().then((err: { error?: string }) => {
        throw new Error(err.error ?? r.statusText);
      });
    }
    return undefined;
  });
}

async function parseJsonError(r: Response): Promise<never> {
  const err = (await r.json().catch(() => ({}))) as { error?: string };
  throw new Error(err.error ?? r.statusText);
}

export function getTheme(themeId: string): Promise<ThemeDetail> {
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function patchTheme(themeId: string, patch: ThemePatch): Promise<ThemeDetail> {
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function getThemeFileText(themeId: string, path: string): Promise<string> {
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}/files/${encoded}`, {
    method: 'GET',
    credentials: 'include',
  }).then(async (r) => {
    if (!r.ok) return parseJsonError(r);
    return r.text();
  });
}

export function putThemeFileText(
  themeId: string,
  path: string,
  content: string,
): Promise<ThemeDetail> {
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}/files/${encoded}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function uploadThemeFile(
  themeId: string,
  path: string,
  file: File,
): Promise<ThemeDetail> {
  const form = new FormData();
  form.append('path', path);
  form.append('file', file);
  return fetch(
    `${BASE}/themes/${encodeURIComponent(themeId)}/files?path=${encodeURIComponent(path)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders(),
      body: form,
    },
  ).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function createThemeFile(themeId: string, path: string): Promise<ThemeDetail> {
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}/files/new`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function deleteThemeFile(themeId: string, path: string): Promise<ThemeDetail> {
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}/files/${encoded}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function setThemeScope(
  themeId: string,
  scope: 'user' | 'server',
): Promise<{ id: string; scope: 'user' | 'server' }> {
  return fetch(`${BASE}/themes/${encodeURIComponent(themeId)}/scope`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

/** Public asset URL for image preview in the editor. */
export function themeAssetPreviewUrl(
  themeId: string,
  scope: 'user' | 'server',
  relativePath: string,
): string {
  const encoded = relativePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  if (scope === 'server') {
    return `${BASE}/public/themes/builtin/${encodeURIComponent(themeId)}/assets/${encoded}`;
  }
  return `${BASE}/public/themes/${encodeURIComponent(themeId)}/assets/${encoded}`;
}

export function listThemeDestinations(): Promise<ThemeCatalogDestinationsResponse> {
  return fetch(`${BASE}/themes/destinations`, {
    method: 'GET',
    credentials: 'include',
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function addThemeDestination(input: {
  name: string;
  url: string;
}): Promise<{ destination: ThemeDestination }> {
  return fetch(`${BASE}/themes/destinations`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function deleteThemeDestination(destinationId: string): Promise<void> {
  return fetch(`${BASE}/themes/destinations/${encodeURIComponent(destinationId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return undefined;
  });
}

export function browseThemeDestinationCatalog(
  destinationId: string,
): Promise<ThemeCatalogBrowseResponse> {
  return fetch(
    `${BASE}/themes/destinations/${encodeURIComponent(destinationId)}/catalog`,
    {
      method: 'GET',
      credentials: 'include',
    },
  ).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function installThemeFromCatalog(input: {
  destinationId: string;
  packageId: string;
  scope: 'user' | 'server';
}): Promise<ThemeCatalogInstallResponse> {
  return fetch(`${BASE}/themes/catalog/install`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}

export function updateServerThemeFromCatalog(
  builtinId: string,
): Promise<ThemeBuiltinUpdateResponse> {
  return fetch(`${BASE}/themes/builtins/${encodeURIComponent(builtinId)}/update`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  }).then((r) => {
    if (!r.ok) return parseJsonError(r);
    return r.json();
  });
}
