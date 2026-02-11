import { z } from 'zod';

export const exportModeSchema = z.enum(['S3', 'FTP', 'SFTP', 'WebDAV', 'IPFS', 'SMB']);
export type ExportMode = z.infer<typeof exportModeSchema>;

const optionalUrl = z.union([z.string().url(), z.literal('')]).optional().nullable()
  .transform((v) => (v === '' || v == null ? null : v));

const s3Create = z.object({
  mode: z.literal('S3'),
  name: z.string().min(1, { message: 'Name is required' }),
  bucket: z.string().min(1, { message: 'Bucket is required' }),
  prefix: z.string().default(''),
  region: z.string().min(1, { message: 'Region is required' }),
  endpoint_url: optionalUrl,
  access_key_id: z.string().min(1, { message: 'Access key is required' }),
  secret_access_key: z.string().min(1, { message: 'Secret key is required' }),
  public_base_url: z.string().url().optional().nullable(),
});

const ftpCreate = z.object({
  mode: z.literal('FTP'),
  name: z.string().min(1, { message: 'Name is required' }),
  host: z.string().min(1, { message: 'Host is required' }),
  port: z.coerce.number().int().min(1).max(65535).optional().default(21),
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
  path: z.string().default(''),
  secure: z.boolean().optional().default(false),
  public_base_url: z.string().url().optional().nullable(),
});

const sftpCreate = z.object({
  mode: z.literal('SFTP'),
  name: z.string().min(1, { message: 'Name is required' }),
  host: z.string().min(1, { message: 'Host is required' }),
  port: z.coerce.number().int().min(1).max(65535).optional().default(22),
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().optional(),
  private_key: z.string().optional(),
  path: z.string().default(''),
  public_base_url: z.string().url().optional().nullable(),
}).refine((d) => d.password != null && d.password !== '' || (d.private_key != null && d.private_key !== ''), {
  message: 'Provide either password or private_key',
  path: ['password'],
});

const webdavCreate = z.object({
  mode: z.literal('WebDAV'),
  name: z.string().min(1, { message: 'Name is required' }),
  url: z.string().url({ message: 'WebDAV URL is required' }),
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
  path: z.string().default(''),
  public_base_url: z.string().url().optional().nullable(),
});

const ipfsCreate = z.object({
  mode: z.literal('IPFS'),
  name: z.string().min(1, { message: 'Name is required' }),
  api_url: z.string().url({ message: 'IPFS API URL is required (e.g. http://127.0.0.1:5001)' }),
  api_key: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  path: z.string().default(''),
  gateway_url: z.string().url().optional().nullable(),
  public_base_url: z.string().url().optional().nullable(),
});

const smbCreate = z.object({
  mode: z.literal('SMB'),
  name: z.string().min(1, { message: 'Name is required' }),
  host: z.string().min(1, { message: 'Host is required' }),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  share: z.string().min(1, { message: 'Share name is required' }),
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
  domain: z.string().optional().default(''),
  path: z.string().default(''),
  public_base_url: z.string().url().optional().nullable(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- preprocess callback receives (data, ctx); we only use data
function normalizeExportCreateBody(body: unknown, _ctx: unknown): unknown {
  if (body == null || typeof body !== 'object') return body;
  const o = body as Record<string, unknown>;
  if (o.mode != null) return body;
  const p = o.provider;
  if (typeof p !== 'string') return body;
  const mode = p.toUpperCase();
  if (['S3', 'FTP', 'SFTP', 'WEBDAV', 'IPFS', 'SMB'].includes(mode)) {
    return { ...o, mode: mode === 'WEBDAV' ? 'WebDAV' : mode };
  }
  return body;
}

const exportCreateUnion = z.discriminatedUnion('mode', [
  s3Create,
  ftpCreate,
  sftpCreate,
  webdavCreate,
  ipfsCreate,
  smbCreate,
]);

export const exportCreateSchema = z.preprocess(normalizeExportCreateBody, exportCreateUnion);

export const exportUpdateSchema = z.object({
  mode: exportModeSchema.optional(),
  name: z.string().min(1).optional(),
  prefix: z.string().optional(),
  public_base_url: z.string().url().optional().nullable(),
  // S3
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint_url: optionalUrl,
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  // FTP
  host: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  // SFTP
  private_key: z.string().optional(),
  // WebDAV
  url: z.string().url().optional(),
  // IPFS
  api_url: z.string().url().optional(),
  api_key: z.string().optional(),
  gateway_url: z.string().url().optional().nullable(),
  // SMB
  share: z.string().optional(),
  domain: z.string().optional(),
}).strict();

export type ExportCreate = z.infer<typeof exportCreateSchema>;
export type ExportUpdate = z.infer<typeof exportUpdateSchema>;
