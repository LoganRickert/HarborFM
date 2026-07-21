import { z } from 'zod';

/** Max theme zip size (client and server). */
export const FEED_THEME_ZIP_MAX_BYTES = 10 * 1024 * 1024;

export const feedThemePackageIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, {
    error: 'Theme id: lowercase letters, numbers, hyphens, underscores; start with alphanumeric',
  });

/**
 * Template basename (no .liquid): lowercase letters, numbers, hyphens, underscores.
 * Leading underscore marks a private partial (not a public .html page).
 */
export const feedThemeTemplateBasenameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(_?[a-z0-9][a-z0-9_-]*)$/, {
    error:
      'Template name: lowercase letters, numbers, hyphens, underscores; optional leading underscore for partials',
  });

/** Public page path must be a single .html filename. */
export const feedThemePagePublicPathSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*\.html$/, {
    error: 'Page path must be a lowercase .html filename (e.g. about.html)',
  });

/**
 * Optional gallery/card preview path inside the package.
 * Must be a single file under images/ with an allowed image extension.
 */
export const feedThemePreviewPathSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^images\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|gif|webp)$/i, {
    error:
      'preview must be a single images/ file with extension .png, .jpg, .jpeg, .gif, or .webp',
  });

export const feedThemeManifestSchema = z.object({
  id: feedThemePackageIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
  /**
   * Short blurb for Themes UI cards and similar surfaces.
   * Plain text; keep it to one or two sentences.
   */
  description: z.string().trim().min(1).max(280).optional(),
  /** Template basename used for feed home. Default: podcast. */
  index: feedThemeTemplateBasenameSchema.optional(),
  /**
   * Template basename for unknown theme .html URLs (themed 404).
   * Not published as a public page. Typical value: `not_found`.
   */
  not_found: feedThemeTemplateBasenameSchema.optional(),
  /**
   * Optional public-path overrides for extra templates.
   * Keys are template basenames; values are public .html filenames.
   */
  pages: z.record(feedThemeTemplateBasenameSchema, feedThemePagePublicPathSchema).optional(),
  /**
   * Optional path to a preview image inside the package (e.g. images/preview.webp).
   * Used by the docs gallery and similar surfaces; omit when unused.
   */
  preview: feedThemePreviewPathSchema.optional(),
  /**
   * Optional public homepage for the theme (docs gallery, credit links in footers).
   * Must be an https URL. Typical gallery URL: https://harborfm.com/themes/{id}/
   */
  homepage: z
    .string()
    .max(500)
    .regex(/^https:\/\/[^\s]+$/i, {
      error: 'homepage must be an https URL with no spaces',
    })
    .optional(),
  /**
   * When false, HarborFM will not replace this server theme from the shipped image on upgrade.
   * Omitted / true means shipped upgrades may overwrite (server themes only). Set to false
   * automatically when an admin edits the theme.
   */
  allowOverride: z.boolean().optional(),
});

export type FeedThemeManifest = z.infer<typeof feedThemeManifestSchema>;

export const feedThemeListItemSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  name: z.string(),
  version: z.string(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FeedThemeListItem = z.infer<typeof feedThemeListItemSchema>;

export const feedThemesListResponseSchema = z.object({
  themes: z.array(feedThemeListItemSchema),
});

export type FeedThemesListResponse = z.infer<typeof feedThemesListResponseSchema>;

export const feedBuiltinThemeListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  /** Optional live preview / docs URL from theme.json `homepage`. */
  homepage: z.string().optional(),
});

export type FeedBuiltinThemeListItem = z.infer<typeof feedBuiltinThemeListItemSchema>;

export const feedBuiltinThemesListResponseSchema = z.object({
  builtins: z.array(feedBuiltinThemeListItemSchema),
});

export type FeedBuiltinThemesListResponse = z.infer<
  typeof feedBuiltinThemesListResponseSchema
>;

export const feedThemeFileInfoSchema = z.object({
  path: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  kind: z.enum(['text', 'image', 'other']),
});

export type FeedThemeFileInfo = z.infer<typeof feedThemeFileInfoSchema>;

export const feedThemeDetailSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  name: z.string(),
  version: z.string(),
  scope: z.enum(['user', 'server']),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  index: feedThemeTemplateBasenameSchema,
  notFound: feedThemeTemplateBasenameSchema.nullable(),
  pages: z.record(feedThemeTemplateBasenameSchema, feedThemePagePublicPathSchema),
  templates: z.array(feedThemeTemplateBasenameSchema),
  files: z.array(feedThemeFileInfoSchema),
});

export type FeedThemeDetail = z.infer<typeof feedThemeDetailSchema>;

export const feedThemePatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    version: z.string().min(1).max(64).optional(),
    index: feedThemeTemplateBasenameSchema.optional(),
    not_found: feedThemeTemplateBasenameSchema.nullable().optional(),
    pages: z
      .record(feedThemeTemplateBasenameSchema, feedThemePagePublicPathSchema)
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'At least one field is required' });

export type FeedThemePatch = z.infer<typeof feedThemePatchSchema>;

export const feedThemeScopeBodySchema = z.object({
  scope: z.enum(['user', 'server']),
});

export type FeedThemeScopeBody = z.infer<typeof feedThemeScopeBodySchema>;
