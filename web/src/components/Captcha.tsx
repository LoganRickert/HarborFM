import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export type CaptchaProvider = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';

export interface CaptchaHandle {
  getToken: () => Promise<string>;
  /** Clear a solved visible captcha so the user must complete it again. */
  reset: () => void;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
      getResponse: (widgetId?: number) => string;
      reset: (widgetId?: number) => void;
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => number;
    };
    hcaptcha?: {
      render: (
        container: string | HTMLElement,
        params: {
          sitekey: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => number;
      getResponse: (widgetId?: number) => string;
      reset: (widgetId?: number) => void;
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
  /** Called when a visible captcha (v2 / hCaptcha) is completed, expired, or cleared. */
  onSolvedChange?: (solved: boolean) => void;
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
  { provider, siteKey, action: actionProp = 'login', onSolvedChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);
  const onSolvedChangeRef = useRef(onSolvedChange);
  onSolvedChangeRef.current = onSolvedChange;

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
      reset: () => {
        // v3 issues a fresh token on each execute(); nothing to clear.
        if (provider === 'recaptcha_v3') return;
        const wid = widgetIdRef.current;
        if (wid == null) return;
        try {
          if (provider === 'recaptcha_v2' && window.grecaptcha) {
            window.grecaptcha.reset(wid);
          } else if (provider === 'hcaptcha' && window.hcaptcha) {
            window.hcaptcha.reset(wid);
          }
        } catch {
          // Widget may already be gone
        }
        onSolvedChangeRef.current?.(false);
      },
    }),
    [provider, siteKey, actionProp]
  );

  useEffect(() => {
    if (!siteKey) return;
    onSolvedChangeRef.current?.(provider === 'recaptcha_v3');

    if (provider === 'recaptcha_v3') {
      loadScript(`${RECAPTCHA_SCRIPT}?render=${encodeURIComponent(siteKey)}`);
      return;
    }

    if (provider === 'recaptcha_v2') {
      const doRender = () => {
        if (!containerRef.current || !window.grecaptcha) return;
        try {
          widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
            sitekey: siteKey,
            callback: () => onSolvedChangeRef.current?.(true),
            'expired-callback': () => onSolvedChangeRef.current?.(false),
            'error-callback': () => onSolvedChangeRef.current?.(false),
          });
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
        onSolvedChangeRef.current?.(false);
      };
    }

    if (provider === 'hcaptcha') {
      const doRender = () => {
        if (widgetIdRef.current != null || !containerRef.current || !window.hcaptcha) return;
        try {
          widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
            sitekey: siteKey,
            callback: () => onSolvedChangeRef.current?.(true),
            'expired-callback': () => onSolvedChangeRef.current?.(false),
            'error-callback': () => onSolvedChangeRef.current?.(false),
          });
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
        onSolvedChangeRef.current?.(false);
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
