import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { feedAccentCssVars } from '../../utils/feedAccent';
import {
  bindHarborfmActions,
  type HarborfmActionHandlers,
} from './harborfmActions';
import { LiquidThemeChromeProvider } from './LiquidThemeChrome';
import styles from './LiquidFeedPage.module.css';

export type HarborfmBlockName =
  | 'site_header'
  | 'show_header'
  | 'episodes'
  | 'player'
  | 'reviews'
  | 'cast'
  | 'funding'
  | 'links'
  | 'podroll'
  | 'search'
  | 'breadcrumbs';

const HARBORFM_BLOCK_NAMES: HarborfmBlockName[] = [
  'site_header',
  'show_header',
  'episodes',
  'player',
  'reviews',
  'cast',
  'funding',
  'links',
  'podroll',
  'search',
  'breadcrumbs',
];

export type LiquidFeedBlocks = Partial<Record<HarborfmBlockName, ReactNode>>;

type ThemeHeadLink = {
  rel: string;
  href: string;
  crossOrigin: string | null;
};

function parseThemeDocument(fullHtml: string): {
  bodyHtml: string;
  bodyClassName: string;
  inlineStyles: string[];
  headLinks: ThemeHeadLink[];
} {
  const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
  const inlineStyles = Array.from(doc.head.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .filter(Boolean);
  const headLinks: ThemeHeadLink[] = [];
  for (const el of Array.from(doc.head.querySelectorAll('link[href]'))) {
    const rel = (el.getAttribute('rel') || '').trim().toLowerCase();
    const href = (el.getAttribute('href') || '').trim();
    if (!href) continue;
    if (
      rel === 'stylesheet' ||
      rel === 'preconnect' ||
      rel === 'dns-prefetch' ||
      rel.split(/\s+/).includes('stylesheet')
    ) {
      headLinks.push({
        rel: el.getAttribute('rel') || 'stylesheet',
        href,
        crossOrigin: el.getAttribute('crossorigin'),
      });
    }
  }
  return {
    bodyHtml: doc.body.innerHTML,
    bodyClassName: doc.body.className || '',
    inlineStyles,
    headLinks,
  };
}

export interface LiquidFeedPageProps {
  html: string;
  cssHrefs: string[];
  accent?: string | null;
  blocks: LiquidFeedBlocks;
  /** Handlers for `[data-harborfm-action]` controls in theme HTML. */
  actions?: HarborfmActionHandlers;
  /**
   * Share / Subscribe / Message / Alerts / Review dialogs.
   * Rendered under a themed host (outside the Liquid body wipe) so theme CSS
   * can style `[data-harborfm-dialog]` with remapped tokens.
   */
  dialogs?: ReactNode;
}

export function LiquidFeedPage({
  html,
  cssHrefs,
  accent,
  blocks,
  actions,
  dialogs,
}: LiquidFeedPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mountNodes, setMountNodes] = useState<
    Partial<Record<HarborfmBlockName, Element>>
  >({});
  const [domReady, setDomReady] = useState(0);
  const parsed = useMemo(() => parseThemeDocument(html), [html]);
  const inlineStylesKey = parsed.inlineStyles.join('\n');
  const headLinksKey = parsed.headLinks
    .map((l) => `${l.rel}|${l.href}|${l.crossOrigin ?? ''}`)
    .join('\n');
  const accentStyle = feedAccentCssVars(accent);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const appendStylesheet = (href: string) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      const normalized =
        href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')
          ? href
          : `/${href}`;
      link.href = normalized;
      document.head.appendChild(link);
      links.push(link);
    };

    for (const headLink of parsed.headLinks) {
      const link = document.createElement('link');
      link.rel = headLink.rel;
      link.href = headLink.href;
      if (headLink.crossOrigin != null) {
        link.crossOrigin = headLink.crossOrigin === '' ? 'anonymous' : headLink.crossOrigin;
      }
      document.head.appendChild(link);
      links.push(link);
    }

    for (const href of cssHrefs) {
      appendStylesheet(href);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [cssHrefs, headLinksKey, parsed.headLinks]);

  useEffect(() => {
    const styleEls: HTMLStyleElement[] = [];
    for (const css of parsed.inlineStyles) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      styleEls.push(style);
    }
    return () => {
      for (const style of styleEls) style.remove();
    };
  }, [inlineStylesKey, parsed.inlineStyles]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = parsed.bodyHtml;

    const next: Partial<Record<HarborfmBlockName, Element>> = {};
    for (const blockName of HARBORFM_BLOCK_NAMES) {
      const mountEl = container.querySelector(`[data-harborfm-block="${blockName}"]`);
      if (mountEl) next[blockName] = mountEl;
    }
    setMountNodes(next);
    setDomReady((n) => n + 1);
  }, [parsed.bodyHtml]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !actions) return;
    return bindHarborfmActions(container, actions);
  }, [actions, domReady, parsed.bodyHtml]);

  const portals = HARBORFM_BLOCK_NAMES.map((blockName) => {
    const el = mountNodes[blockName];
    const node = blocks[blockName];
    if (!el || node == null) return null;
    return createPortal(node, el, blockName);
  });

  const themeClass = parsed.bodyClassName;

  return (
    <LiquidThemeChromeProvider themeClassName={themeClass}>
      <div
        className={[styles.liquidFeed, themeClass].filter(Boolean).join(' ')}
        style={accentStyle}
      >
        <div className={styles.liquidBody} ref={containerRef} />
        {portals}
      </div>
      {dialogs != null ? (
        <div
          className={[styles.dialogRoot, themeClass].filter(Boolean).join(' ')}
          style={accentStyle}
          data-harborfm-dialog-root=""
        >
          {dialogs}
        </div>
      ) : null}
    </LiquidThemeChromeProvider>
  );
}
