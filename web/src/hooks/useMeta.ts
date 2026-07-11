import { useEffect } from 'react';
import { DEFAULT_OG_IMAGE_PATH, truncateMetaDescription } from '@harborfm/shared';
import { DEFAULT_SITE_NAME } from '../utils/siteBranding';

const DEFAULT_DESCRIPTION = 'HarborFM - Create and manage your podcast with ease. Record, edit, and publish episodes all in one place.';
const DEFAULT_TITLE = 'HarborFM';
const OG_IMAGE = DEFAULT_OG_IMAGE_PATH;
const DEFAULT_FAVICON = '/favicon.png';

function toAbsoluteUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (typeof window !== 'undefined') {
    return new URL(url, window.location.origin).href;
  }
  return url;
}

function getOrCreateMetaTag(property: string, attribute: 'name' | 'property' = 'property'): HTMLMetaElement {
  let meta = document.querySelector(`meta[${attribute}="${property}"]`) as HTMLMetaElement;
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, property);
    document.head.appendChild(meta);
  }
  return meta;
}

function getFaviconLink(): HTMLLinkElement {
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

function faviconTypeForUrl(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

export function useMeta({
  title,
  description,
  image,
  siteName,
  url,
  favicon,
}: {
  title?: string;
  description?: string;
  image?: string;
  /** og:site_name (e.g. white-label name or HarborFM). */
  siteName?: string;
  /** Canonical page URL for og:url. */
  url?: string;
  /** When set, updates the browser tab icon (e.g. podcast cover on a linking domain). */
  favicon?: string | null;
}) {
  useEffect(() => {
    const originalTitle = document.title;
    const metaDescription = getOrCreateMetaTag('description', 'name');
    const ogTitle = getOrCreateMetaTag('og:title');
    const ogDescription = getOrCreateMetaTag('og:description');
    const ogSiteName = getOrCreateMetaTag('og:site_name');
    const ogUrl = getOrCreateMetaTag('og:url');
    const ogImage = getOrCreateMetaTag('og:image');
    const twitterTitle = getOrCreateMetaTag('twitter:title', 'name');
    const twitterDescription = getOrCreateMetaTag('twitter:description', 'name');
    const twitterImage = getOrCreateMetaTag('twitter:image', 'name');
    const faviconLink = favicon != null ? getFaviconLink() : null;
    const originalFaviconHref = faviconLink?.getAttribute('href') ?? DEFAULT_FAVICON;
    const originalFaviconType = faviconLink?.getAttribute('type');
    const originalSiteName = ogSiteName.getAttribute('content') ?? DEFAULT_SITE_NAME;
    const originalUrl = ogUrl.getAttribute('content') ?? '/';

    if (title) {
      document.title = title;
      ogTitle.setAttribute('content', title);
      twitterTitle.setAttribute('content', title);
    }

    if (description) {
      const metaDescriptionText = truncateMetaDescription(description);
      metaDescription.setAttribute('content', metaDescriptionText);
      ogDescription.setAttribute('content', metaDescriptionText);
      twitterDescription.setAttribute('content', metaDescriptionText);
    }

    if (siteName) {
      ogSiteName.setAttribute('content', siteName);
    }

    if (url) {
      ogUrl.setAttribute('content', toAbsoluteUrl(url));
    }

    const imageUrl = toAbsoluteUrl(image || OG_IMAGE);
    ogImage.setAttribute('content', imageUrl);
    twitterImage.setAttribute('content', imageUrl);

    if (faviconLink && favicon) {
      faviconLink.href = favicon;
      const type = faviconTypeForUrl(favicon);
      if (type) faviconLink.type = type;
      else faviconLink.removeAttribute('type');
    }

    return () => {
      if (title) {
        document.title = originalTitle;
        ogTitle.setAttribute('content', DEFAULT_TITLE);
        twitterTitle.setAttribute('content', DEFAULT_TITLE);
      }
      if (description) {
        metaDescription.setAttribute('content', DEFAULT_DESCRIPTION);
        ogDescription.setAttribute('content', DEFAULT_DESCRIPTION);
        twitterDescription.setAttribute('content', DEFAULT_DESCRIPTION);
      }
      if (siteName) {
        ogSiteName.setAttribute('content', originalSiteName);
      }
      if (url) {
        ogUrl.setAttribute('content', originalUrl);
      }
      ogImage.setAttribute('content', toAbsoluteUrl(OG_IMAGE));
      twitterImage.setAttribute('content', toAbsoluteUrl(OG_IMAGE));
      if (faviconLink && favicon) {
        faviconLink.href = originalFaviconHref;
        if (originalFaviconType) faviconLink.type = originalFaviconType;
        else faviconLink.removeAttribute('type');
      }
    };
  }, [title, description, image, siteName, url, favicon]);
}
