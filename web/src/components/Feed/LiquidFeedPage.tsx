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

function parseThemeDocument(fullHtml: string): {
  bodyHtml: string;
  bodyClassName: string;
  inlineStyles: string[];
} {
  const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
  const inlineStyles = Array.from(doc.head.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .filter(Boolean);
  return {
    bodyHtml: doc.body.innerHTML,
    bodyClassName: doc.body.className || '',
    inlineStyles,
  };
}

export interface LiquidFeedPageProps {
  html: string;
  cssHrefs: string[];
  accent?: string | null;
  blocks: LiquidFeedBlocks;
}

export function LiquidFeedPage({ html, cssHrefs, accent, blocks }: LiquidFeedPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mountNodes, setMountNodes] = useState<
    Partial<Record<HarborfmBlockName, Element>>
  >({});
  const parsed = useMemo(() => parseThemeDocument(html), [html]);
  const inlineStylesKey = parsed.inlineStyles.join('\n');

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (const href of cssHrefs) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      // Root-relative: "api/..." must become "/api/..." or the browser resolves under /feed/...
      const normalized =
        href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')
          ? href
          : `/${href}`;
      link.href = normalized;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [cssHrefs]);

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
  }, [parsed.bodyHtml]);

  const portals = HARBORFM_BLOCK_NAMES.map((blockName) => {
    const el = mountNodes[blockName];
    const node = blocks[blockName];
    if (!el || node == null) return null;
    return createPortal(node, el, blockName);
  });

  return (
    <>
      <div
        className={[styles.liquidFeed, parsed.bodyClassName].filter(Boolean).join(' ')}
        style={feedAccentCssVars(accent)}
        ref={containerRef}
      />
      {portals}
    </>
  );
}
