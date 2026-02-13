import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(__dirname, '..');

export const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3099/api';

/** Simple cookie jar: object of name -> value, serialized as Cookie header. */
export function cookieJar() {
  const jar = {};
  return {
    apply(headers = {}) {
      const cookie = Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (cookie) headers.Cookie = cookie;
      return headers;
    },
    store(setCookieHeaderOrArray) {
      const parts = setCookieHeaderOrArray == null
        ? []
        : Array.isArray(setCookieHeaderOrArray)
          ? setCookieHeaderOrArray
          : [setCookieHeaderOrArray];
      for (const part of parts) {
        const [pair] = part.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          jar[name] = value;
        }
      }
    },
    get() {
      return { ...jar };
    },
  };
}

/** Get all Set-Cookie headers from a fetch Response (Node 18+ has getSetCookie). */
function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

/** Read setup token from e2e data dir (written by run-e2e.sh before server start). */
export function getSetupToken() {
  const dataDir = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');
  const path = join(dataDir, 'setup-token.txt');
  if (!existsSync(path)) throw new Error('e2e: setup-token.txt not found. Run via pnpm run e2e.');
  return readFileSync(path, 'utf8').trim();
}

/** Delete cached sitemap index so the next request generates a fresh sitemap. Uses E2E_DATA_DIR (server DATA_DIR). */
export function deleteSitemapCache() {
  const dataDir = process.env.E2E_DATA_DIR || join(E2E_DIR, 'data');
  const path = join(dataDir, 'sitemap', 'index.xml');
  if (existsSync(path)) unlinkSync(path);
}

/**
 * Complete setup and return admin credentials + cookie jar.
 * Call once at start of test run (server has no users yet).
 */
export async function completeSetup(opts = {}) {
  const token = getSetupToken();
  const email = opts.email || 'admin@e2e.test';
  const password = opts.password || 'admin-password-123';

  const res = await fetch(`${baseURL}/setup/complete?id=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      hostname: opts.hostname || 'http://localhost:3099',
      registration_enabled: opts.registration_enabled !== false,
      public_feeds_enabled: opts.public_feeds_enabled !== false,
      import_pixabay_assets: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Setup complete failed: ${res.status} ${t}`);
  }
  return { email, password };
}

/**
 * Login with email/password. Returns { cookies, user } and updates the provided jar.
 */
export async function login(email, password, jar) {
  const res = await fetch(`${baseURL}/auth/login`, {
    method: 'POST',
    headers: jar ? jar.apply({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  jar?.store(getSetCookies(res));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Login failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return { user: data.user, cookies: jar?.get() };
}

/**
 * Login as admin (after setup). Returns cookie jar with session.
 */
export async function loginAsAdmin(opts = {}) {
  const email = opts.email || 'admin@e2e.test';
  const password = opts.password || 'admin-password-123';
  const jar = cookieJar();
  await login(email, password, jar);
  return { jar, email, password, baseURL };
}

/**
 * Fetch with optional cookie jar and JSON body. For PATCH/POST with session, pass jar and x-csrf from cookie.
 */
export async function apiFetch(path, options = {}, jar) {
  const url = path.startsWith('http') ? path : `${baseURL}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = { ...(options.headers || {}) };
  if (jar) {
    jar.apply(headers);
    const csrf = jar.get()['harborfm_csrf'];
    if (csrf && options.method && !['GET', 'HEAD'].includes(options.method)) {
      headers['x-csrf-token'] = csrf;
    }
  }
  const res = await fetch(url, { ...options, headers });
  jar?.store(getSetCookies(res));
  return res;
}

/**
 * GET /public/config with optional host override (simulates request from that host).
 * Use for testing custom_feed_slug when Host matches a podcast's link_domain.
 * @param {string} [hostOverride] - e.g. 'asdf.warpfusion.app'; sets X-Forwarded-Host.
 * @returns {Promise<{ public_feeds_enabled: boolean, custom_feed_slug?: string }>}
 */
export async function getPublicConfig(hostOverride) {
  const headers = {};
  if (hostOverride) headers['X-Forwarded-Host'] = hostOverride;
  const res = await fetch(`${baseURL}/public/config`, { headers });
  if (!res.ok) throw new Error(`GET /public/config failed: ${res.status}`);
  return res.json();
}

/**
 * Register a new user. Requires registration_enabled. Returns { email, password }.
 */
export async function createUser(opts = {}) {
  const email = opts.email || `user-${Date.now()}@e2e.test`;
  const password = opts.password || 'user-password-123';
  const res = await fetch(`${baseURL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Register failed: ${res.status} ${t}`);
  }
  return { email, password };
}

/**
 * Create a show (podcast). Requires admin (or any) session. Pass jar from loginAsAdmin.
 */
export async function createShow(jar, opts = {}) {
  const title = opts.title || 'E2E Show';
  const slug = opts.slug || `e2e-show-${Date.now()}`;
  const res = await apiFetch('/podcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, slug, description: opts.description || '' }),
  }, jar);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Create podcast failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data;
}

/**
 * Create an episode (draft). Optionally pass audio/artwork later via separate endpoints.
 */
export async function createEpisode(jar, podcastId, opts = {}) {
  const res = await apiFetch(`/podcasts/${podcastId}/episodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: opts.title || 'E2E Episode',
      description: opts.description || '',
      status: opts.status || 'draft',
    }),
  }, jar);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Create episode failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data;
}

/** Path to test-data mp3 (for uploads). */
export function testDataMp3() {
  const p = join(E2E_DIR, 'test-data', '20260212_133813_rXR9IQ1yujd-cq4JYRNCY.mp3');
  if (!existsSync(p)) throw new Error('e2e test-data mp3 not found');
  return p;
}

/** Path to test-data png (for artwork). */
export function testDataPng() {
  const p = join(E2E_DIR, 'test-data', 'favicon.png');
  if (!existsSync(p)) throw new Error('e2e test-data favicon.png not found');
  return p;
}

/**
 * Upload episode source audio (multipart). Uses test mp3 by default.
 * Call before processEpisodeAudio. Requires read-write session.
 */
export async function uploadEpisodeAudio(jar, episodeId, _podcastId, filePath) {
  const path = filePath || testDataMp3();
  if (!existsSync(path)) throw new Error(`e2e: upload file not found: ${path}`);
  const buf = readFileSync(path);
  const formData = new FormData();
  formData.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
  const headers = jar ? jar.apply({}) : {};
  delete headers['Content-Type'];
  const csrf = jar?.get()['harborfm_csrf'];
  if (csrf) headers['x-csrf-token'] = csrf;
  const url = `${baseURL}/episodes/${encodeURIComponent(episodeId)}/audio`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  jar?.store(getSetCookies(res));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Upload episode audio failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * Process episode audio (transcode to final). Sync; returns episode. Requires upload first.
 */
export async function processEpisodeAudio(jar, episodeId) {
  const res = await apiFetch(`/episodes/${episodeId}/process-audio`, {
    method: 'POST',
  }, jar);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Process episode audio failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * Add a recorded segment to an episode (multipart upload). Uses test mp3 by default.
 * Returns the created segment object.
 */
export async function addRecordedSegment(jar, episodeId, filePath) {
  const path = filePath || testDataMp3();
  if (!existsSync(path)) throw new Error(`e2e: upload file not found: ${path}`);
  const buf = readFileSync(path);
  const formData = new FormData();
  formData.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
  const headers = jar ? jar.apply({}) : {};
  delete headers['Content-Type'];
  const csrf = jar?.get()['harborfm_csrf'];
  if (csrf) headers['x-csrf-token'] = csrf;
  const url = `${baseURL}/episodes/${encodeURIComponent(episodeId)}/segments`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  jar?.store(getSetCookies(res));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Add recorded segment failed: ${res.status} ${t}`);
  }
  return res.json();
}
