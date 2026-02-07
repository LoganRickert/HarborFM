import { existsSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { ensureDir, getDataDir } from './paths.js';

const SETUP_TOKEN_FILENAME = 'setup-token.txt';

export function isSetupComplete(): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count > 0;
}

function getSetupTokenPath(): string {
  return join(getDataDir(), SETUP_TOKEN_FILENAME);
}

export function readSetupToken(): string | null {
  const path = getSetupTokenPath();
  if (!existsSync(path)) return null;
  const token = readFileSync(path, 'utf8').trim();
  return token || null;
}

export function getOrCreateSetupToken(): string {
  if (isSetupComplete()) {
    throw new Error('Setup is already complete');
  }
  ensureDir(getDataDir());

  const existing = readSetupToken();
  if (existing) return existing;

  const token = nanoid(32);
  const path = getSetupTokenPath();
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort only.
  }
  return token;
}

export function consumeSetupToken(token: string): boolean {
  const existing = readSetupToken();
  if (!existing) return false;
  if (token !== existing) return false;
  try {
    unlinkSync(getSetupTokenPath());
  } catch {
    // Ignore deletion errors; token won't be reusable anyway if setup completes.
  }
  return true;
}

