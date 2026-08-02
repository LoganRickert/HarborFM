import { useEffect } from 'react';
import { useConsent } from '../../hooks/useConsent';

const FB_SCRIPT_ID = 'harborfm-meta-pixel-script';
const FB_SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue?: unknown[];
      loaded?: boolean;
      version?: string;
      push?: (...args: unknown[]) => void;
    };
    _fbq?: Window['fbq'];
  }
}

/** In-memory set of pixel IDs already initialized this page session. */
const initializedPixels = new Set<string>();

function isValidPixelId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^\d{1,20}$/.test(id.trim());
}

function ensureFbqStub(): NonNullable<Window['fbq']> {
  if (typeof window.fbq === 'function') return window.fbq;
  const n = function (...args: unknown[]) {
    const fn = n as NonNullable<Window['fbq']>;
    if (fn.callMethod) {
      fn.callMethod(...args);
    } else {
      (fn.queue ??= []).push(args);
    }
  } as NonNullable<Window['fbq']>;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  window.fbq = n;
  return n;
}

function ensureFbScript(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FB_SCRIPT_ID)) return;
  if (document.querySelector(`script[src="${FB_SCRIPT_SRC}"]`)) return;
  const t = document.createElement('script');
  t.id = FB_SCRIPT_ID;
  t.async = true;
  t.src = FB_SCRIPT_SRC;
  const s = document.getElementsByTagName('script')[0];
  if (s?.parentNode) {
    s.parentNode.insertBefore(t, s);
  } else {
    document.head.appendChild(t);
  }
}

/**
 * Injects Meta Pixel on public feed pages when a valid ID is set.
 * Respects the instance GDPR consent banner when enabled.
 */
export function FeedMetaPixel({
  pixelId,
}: {
  pixelId?: string | null;
}) {
  const { consentGiven, bannerEnabled } = useConsent();
  const allowed =
    isValidPixelId(pixelId) &&
    (!bannerEnabled || consentGiven === true);
  const id = allowed ? pixelId.trim() : null;

  useEffect(() => {
    if (!id) return;
    const fbq = ensureFbqStub();
    ensureFbScript();
    if (!initializedPixels.has(id)) {
      fbq('init', id);
      initializedPixels.add(id);
    }
    fbq('track', 'PageView');
  }, [id]);

  if (!id) return null;

  return (
    <noscript>
      <img
        height={1}
        width={1}
        style={{ display: 'none' }}
        alt=""
        src={`https://www.facebook.com/tr?id=${encodeURIComponent(id)}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
