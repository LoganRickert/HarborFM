export type HarborfmActionName =
  | 'message'
  | 'alerts'
  | 'share'
  | 'subscribe'
  | 'feed'
  | 'write-review';

export type HarborfmActionHandlers = {
  message?: () => void;
  alerts?: () => void;
  share?: () => void;
  subscribe?: () => void;
  feedHref?: string | null;
  writeReview?: () => void;
};

/**
 * Bind theme-authored `[data-harborfm-action]` controls inside a Liquid root.
 * Unavailable actions are hidden. Returns a cleanup that removes listeners.
 */
export function bindHarborfmActions(
  root: ParentNode,
  handlers: HarborfmActionHandlers,
): () => void {
  const cleanups: Array<() => void> = [];
  const nodes = root.querySelectorAll<HTMLElement>('[data-harborfm-action]');

  for (const el of nodes) {
    const action = (el.getAttribute('data-harborfm-action') || '')
      .trim()
      .toLowerCase() as HarborfmActionName;

    const hide = () => {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) {
        el.setAttribute('tabindex', '-1');
      }
    };

    if (action === 'message') {
      if (!handlers.message) {
        hide();
        continue;
      }
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.message?.();
      };
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
      continue;
    }

    if (action === 'alerts') {
      if (!handlers.alerts) {
        hide();
        continue;
      }
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.alerts?.();
      };
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
      continue;
    }

    if (action === 'share') {
      if (!handlers.share) {
        hide();
        continue;
      }
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.share?.();
      };
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
      continue;
    }

    if (action === 'subscribe') {
      if (!handlers.subscribe) {
        hide();
        continue;
      }
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.subscribe?.();
      };
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
      continue;
    }

    if (action === 'feed') {
      if (!handlers.feedHref) {
        hide();
        continue;
      }
      if (el instanceof HTMLAnchorElement) {
        el.href = handlers.feedHref;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      } else {
        const onClick = (e: Event) => {
          e.preventDefault();
          window.open(handlers.feedHref!, '_blank', 'noopener,noreferrer');
        };
        el.addEventListener('click', onClick);
        cleanups.push(() => el.removeEventListener('click', onClick));
      }
      continue;
    }

    if (action === 'write-review') {
      if (!handlers.writeReview) {
        hide();
        continue;
      }
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.writeReview?.();
      };
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
      continue;
    }

    hide();
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
