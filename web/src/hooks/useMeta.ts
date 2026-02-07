import { useEffect } from 'react';

const DEFAULT_DESCRIPTION = 'HarborFM - Create and manage your podcast with ease. Record, edit, and publish episodes all in one place.';
const DEFAULT_TITLE = 'HarborFM';
const OG_IMAGE = '/og-image.png';

function getOrCreateMetaTag(property: string, attribute: 'name' | 'property' = 'property'): HTMLMetaElement {
  let meta = document.querySelector(`meta[${attribute}="${property}"]`) as HTMLMetaElement;
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, property);
    document.head.appendChild(meta);
  }
  return meta;
}

export function useMeta({
  title,
  description,
  image,
}: {
  title?: string;
  description?: string;
  image?: string;
}) {
  useEffect(() => {
    const originalTitle = document.title;
    const metaDescription = getOrCreateMetaTag('description', 'name');
    const ogTitle = getOrCreateMetaTag('og:title');
    const ogDescription = getOrCreateMetaTag('og:description');
    const ogImage = getOrCreateMetaTag('og:image');
    const twitterImage = getOrCreateMetaTag('twitter:image', 'name');

    if (title) {
      document.title = title;
      ogTitle.setAttribute('content', title);
    }

    if (description) {
      metaDescription.setAttribute('content', description);
      ogDescription.setAttribute('content', description);
    }

    const imageUrl = image || OG_IMAGE;
    ogImage.setAttribute('content', imageUrl);
    twitterImage.setAttribute('content', imageUrl);

    return () => {
      if (title) {
        document.title = originalTitle;
        ogTitle.setAttribute('content', DEFAULT_TITLE);
      }
      if (description) {
        metaDescription.setAttribute('content', DEFAULT_DESCRIPTION);
        ogDescription.setAttribute('content', DEFAULT_DESCRIPTION);
      }
      ogImage.setAttribute('content', OG_IMAGE);
      twitterImage.setAttribute('content', OG_IMAGE);
    };
  }, [title, description, image]);
}
