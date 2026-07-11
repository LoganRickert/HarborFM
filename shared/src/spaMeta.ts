export type SpaPageMeta = {
  title: string;
  description: string;
  siteName: string;
  url: string;
  image: string;
};

export const DEFAULT_OG_IMAGE_PATH = '/og-image.svg';
export const META_DESCRIPTION_MAX_LENGTH = 160;

/** Normalize and truncate text for meta/OG description tags. */
export function truncateMetaDescription(
  text: string,
  maxLength: number = META_DESCRIPTION_MAX_LENGTH,
): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length <= maxLength) return normalized;
  const slice = normalized.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}...`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function setMetaContent(
  html: string,
  attribute: 'name' | 'property',
  key: string,
  content: string,
): string {
  const escaped = escapeHtmlAttr(content);
  const pattern = new RegExp(
    `(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`,
    'i',
  );
  if (pattern.test(html)) {
    return html.replace(pattern, `$1${escaped}$2`);
  }
  return html.replace(
    '</head>',
    `<meta ${attribute}="${key}" content="${escaped}" />\n</head>`,
  );
}

/** Inject podcast/episode meta into the SPA index.html shell (for crawlers and view-source). */
export function injectSpaMetaHtml(html: string, meta: SpaPageMeta): string {
  const description = truncateMetaDescription(meta.description);
  let out = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtmlAttr(meta.title)}</title>`,
  );

  out = setMetaContent(out, 'name', 'description', description);
  out = setMetaContent(out, 'property', 'og:type', 'website');
  out = setMetaContent(out, 'property', 'og:title', meta.title);
  out = setMetaContent(out, 'property', 'og:description', description);
  out = setMetaContent(out, 'property', 'og:site_name', meta.siteName);
  out = setMetaContent(out, 'property', 'og:url', meta.url);
  out = setMetaContent(out, 'property', 'og:image', meta.image);
  out = setMetaContent(out, 'name', 'twitter:card', 'summary_large_image');
  out = setMetaContent(out, 'name', 'twitter:title', meta.title);
  out = setMetaContent(out, 'name', 'twitter:description', description);
  out = setMetaContent(out, 'name', 'twitter:image', meta.image);

  return out;
}
