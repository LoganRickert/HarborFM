/**
 * Unify exports table: all modes (including S3) use config_enc. Migrate existing S3 rows
 * into config_enc, then drop S3-specific columns and provider.
 */
import type { Database } from 'better-sqlite3';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../../services/secrets.js';

const AAD = 'harborfm:exports';

export const up = (db: Database) => {
  const tableInfo = db.prepare('PRAGMA table_info(exports)').all() as { name: string }[];
  const columnNames = tableInfo.map((c) => c.name);
  const hasLegacyColumns = columnNames.includes('bucket');

  // Older schemas may have bucket/etc. but no mode column (e.g. had "provider" or was added before mode existed).
  if (hasLegacyColumns && !columnNames.includes('mode')) {
    db.exec(`ALTER TABLE exports ADD COLUMN mode TEXT NOT NULL DEFAULT 'S3'`);
  }

  if (hasLegacyColumns) {
    const rows = db.prepare(`SELECT id, mode, config_enc, bucket, prefix, region, endpoint_url,
    bucket_enc, region_enc, endpoint_url_enc,
    access_key_id, secret_access_key, access_key_id_enc, secret_access_key_enc
    FROM exports`).all() as Record<string, unknown>[];

  const updateStmt = db.prepare('UPDATE exports SET config_enc = ? WHERE id = ?');

  for (const row of rows) {
    const configEnc = row.config_enc as string | null | undefined;
    if (configEnc && isEncryptedSecret(configEnc)) {
      continue; // already has config (non-S3 or already migrated)
    }
    const mode = (row.mode as string) || 'S3';
    if (mode !== 'S3') continue;

    let bucket: string;
    let region: string;
    let endpoint: string | null;
    const bucketEnc = row.bucket_enc as string | null | undefined;
    const regionEnc = row.region_enc as string | null | undefined;
    const endpointEnc = row.endpoint_url_enc as string | null | undefined;

    if (bucketEnc && isEncryptedSecret(bucketEnc)) {
      bucket = decryptSecret(bucketEnc, AAD);
      region = regionEnc && isEncryptedSecret(regionEnc) ? decryptSecret(regionEnc, AAD) : String(row.region ?? '');
      endpoint = endpointEnc && isEncryptedSecret(endpointEnc) ? decryptSecret(endpointEnc, AAD) : (row.endpoint_url as string)?.trim() || null;
    } else {
      bucket = String(row.bucket ?? '');
      region = String(row.region ?? '');
      endpoint = (row.endpoint_url as string)?.trim() || null;
    }

    const prefix = String(row.prefix ?? '');
    let accessKeyId: string;
    let secretAccessKey: string;
    const accessKeyEnc = row.access_key_id_enc as string | null | undefined;
    const secretEnc = row.secret_access_key_enc as string | null | undefined;
    if (accessKeyEnc && secretEnc && isEncryptedSecret(accessKeyEnc) && isEncryptedSecret(secretEnc)) {
      accessKeyId = decryptSecret(accessKeyEnc, AAD);
      secretAccessKey = decryptSecret(secretEnc, AAD);
    } else {
      accessKeyId = String(row.access_key_id ?? '');
      secretAccessKey = String(row.secret_access_key ?? '');
    }

    const obj = {
      bucket,
      prefix,
      region,
      endpoint_url: endpoint,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
    };
    const encrypted = encryptSecret(JSON.stringify(obj), AAD);
    updateStmt.run(encrypted, row.id);
  }
  }

  const columnsToDrop = [
    'provider',
    'bucket',
    'prefix',
    'region',
    'endpoint_url',
    'bucket_enc',
    'region_enc',
    'endpoint_url_enc',
    'access_key_id',
    'secret_access_key',
    'access_key_id_enc',
    'secret_access_key_enc',
  ];
  const tableInfoAfter = db.prepare('PRAGMA table_info(exports)').all() as { name: string }[];
  const existingCols = new Set(tableInfoAfter.map((c) => c.name));
  for (const col of columnsToDrop) {
    if (existingCols.has(col)) {
      db.exec(`ALTER TABLE exports DROP COLUMN ${col}`);
    }
  }
};

export const down = (_db: Database) => {
  // Irreversible without backup of dropped columns.
};
