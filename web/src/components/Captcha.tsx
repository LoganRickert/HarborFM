import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export type CaptchaProvider = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';

export interface CaptchaHandle {
  getToken: () => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
      getResponse: (widgetId?: number) => string;
      render: (container: string | HTMLElement, options: { sitekey: string }) => number;
    };
    hcaptcha?: {
      render: (container: string | HTMLElement, params: { sitekey: string }) => number;
      getResponse: (widgetId?: number) => string;
    };
    onRecaptchaLoad?: () => void;
    onHcaptchaLoad?: () => void;
  }
}

const RECAPTCHA_SCRIPT = 'https://www.google.com/recaptcha/api.js';
const HCAPTCHA_SCRIPT = 'https://js.hcaptcha.com/1/api.js';

interface CaptchaProps {
  provider: CaptchaProvider;
  siteKey: string;
  /** reCAPTCHA v3 action name (e.g. 'login', 'contact'). Default 'login'. */
  action?: string;
}

function loadScript(src: string, onload?: () => void): void {
  if (document.querySelector(`script[src="${src}"]`)) {
    onload?.();
    return;
  }
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;
  if (onload) script.onload = onload;
  document.head.appendChild(script);
}

export const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(function Captcha(
  { provider, siteKey, action: actionProp = 'login' },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getToken: (): Promise<string> => {
        if (provider === 'recaptcha_v3') {
          if (!window.grecaptcha) return Promise.resolve('');
          return new Promise<void>((resolve) => {
            window.grecaptcha!.ready(resolve);
          }).then(() => window.grecaptcha!.execute(siteKey, { action: actionProp }));
        }
        if (provider === 'recaptcha_v2') {
          if (!window.grecaptcha) return Promise.resolve('');
          const wid = widgetIdRef.current ?? undefined;
          const token = window.grecaptcha.getResponse(wid);
          return Promise.resolve(token || '');
        }
        if (provider === 'hcaptcha' && window.hcaptcha) {
          const wid = widgetIdRef.current ?? undefined;
          const token = window.hcaptcha.getResponse(wid);
          return Promise.resolve(token || '');
        }
        return Promise.resolve('');
      },
    }),
    [provider, siteKey, actionProp]
  );

  useEffect(() => {
    if (!siteKey) return;

    if (provider === 'recaptcha_v3') {
      loadScript(`${RECAPTCHA_SCRIPT}?render=${encodeURIComponent(siteKey)}`);
      return;
    }

    if (provider === 'recaptcha_v2') {
      const doRender = () => {
        if (!containerRef.current || !window.grecaptcha) return;
        try {
          widgetIdRef.current = window.grecaptcha.render(containerRef.current, { sitekey: siteKey });
        } catch {
          // already rendered or invalid
        }
      };
      window.onRecaptchaLoad = doRender;
      const scriptUrl = `${RECAPTCHA_SCRIPT}?onload=onRecaptchaLoad&render=explicit`;
      loadScript(scriptUrl, () => {
        // Script already in page: grecaptcha may be ready; run render when ready
        window.grecaptcha?.ready?.(doRender);
      });
      return () => {
        window.onRecaptchaLoad = undefined;
      };
    }

    if (provider === 'hcaptcha') {
      const doRender = () => {
        if (widgetIdRef.current != null || !containerRef.current || !window.hcaptcha) return;
        try {
          widgetIdRef.current = window.hcaptcha.render(containerRef.current, { sitekey: siteKey });
        } catch {
          // already rendered or invalid
        }
      };
      window.onHcaptchaLoad = doRender;
      const scriptUrl = `${HCAPTCHA_SCRIPT}?onload=onHcaptchaLoad&render=explicit`;
      const scriptAlreadyThere = document.querySelector(`script[src="${scriptUrl}"]`);
      if (scriptAlreadyThere) {
        // API already loaded; defer render to next tick so we're not "before js api is fully loaded"
        setTimeout(doRender, 0);
      } else {
        loadScript(scriptUrl);
        // Render only via onHcaptchaLoad when the API calls it (no second callback = no double render)
      }
      return () => {
        window.onHcaptchaLoad = undefined;
      };
    }
  }, [provider, siteKey]);

  if (provider === 'recaptcha_v3') {
    return null;
  }

  return (
    <div
      className="captcha-container"
      style={{ marginTop: '0.5rem', minHeight: 78, display: 'flex', justifyContent: 'center' }}
    >
      <div ref={containerRef} />
    </div>
  );
});
