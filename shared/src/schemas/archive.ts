import { z } from 'zod';
import {
  exportCreateSchema,
  exportModeSchema,
  exportUpdateSchema,
} from './export.js';

export { exportModeSchema };

/**
 * Archive settings reuse delivery destination fields but omit publicBaseUrl
 * (archives are not public feed destinations).
 */
export const archiveSettingsUpsertSchema = exportCreateSchema;
export const archiveSettingsUpdateSchema = exportUpdateSchema
  .omit({ publicBaseUrl: true })
  .extend({
    name: z.string().min(1).optional(),
  });

export type ArchiveSettingsUpsert = z.infer<typeof archiveSettingsUpsertSchema>;
export type ArchiveSettingsUpdate = z.infer<typeof archiveSettingsUpdateSchema>;
