import { z } from 'zod';

export const exportCreateSchema = z.object({
  provider: z.literal('s3'),
  name: z.string().min(1, 'Name is required'),
  bucket: z.string().min(1, 'Bucket is required'),
  prefix: z.string().default(''),
  region: z.string().min(1, 'Region is required'),
  endpoint_url: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .nullable()
    .transform((v) => (v === '' || v == null ? null : v)),
  access_key_id: z.string().min(1, 'Access key is required'),
  secret_access_key: z.string().min(1, 'Secret key is required'),
  public_base_url: z.string().url().optional().nullable(),
});

export const exportUpdateSchema = exportCreateSchema.partial();

export type ExportCreate = z.infer<typeof exportCreateSchema>;
export type ExportUpdate = z.infer<typeof exportUpdateSchema>;
