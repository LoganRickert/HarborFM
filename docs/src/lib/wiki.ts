import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findRepoRoot } from './paths';
import { renderMarkdown } from './render-md';
import { titleCaseMarkdownHeadings, toTitleCase } from './title-case';

export const WIKI_SKIP_FILES = new Set(['Home.md', 'Instance-manager.md']);

const GITHUB_BLOB = 'https://github.com/LoganRickert/harborfm/blob/main';

export type WikiNavLink = {
  title: string;
  href: string;
  slug: string;
  file: string;
};

export type WikiNavGroup = {
  label: string;
  links: WikiNavLink[];
};

export function wikiFileToSlug(file: string): string {
  return basename(file, '.md').toLowerCase();
}

export function resolveWikiDir(): string | null {
  if (process.env.HARBORFM_WIKI_PATH) {
    const custom = process.env.HARBORFM_WIKI_PATH;
    if (existsSync(join(custom, 'Home.md'))) return custom;
  }
  const root = findRepoRoot();
  const candidates = [
    join(root, 'HarborFM.wiki'),
    join(root, 'wiki'),
    join(process.cwd(), 'HarborFM.wiki'),
    join(process.cwd(), '../HarborFM.wiki'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'Home.md'))) return dir;
  }
  return null;
}

function isSkippedWikiFile(file: string): boolean {
  return WIKI_SKIP_FILES.has(file) || WIKI_SKIP_FILES.has(basename(file));
}

/** Parse Home.md TOC into Usage nav groups. */
export function parseWikiNav(wikiDir: string): WikiNavGroup[] {
  const homePath = join(wikiDir, 'Home.md');
  if (!existsSync(homePath)) return [];

  const source = readFileSync(homePath, 'utf8');
  const groups: WikiNavGroup[] = [];
  let current: WikiNavGroup | null = null;

  for (const line of source.split('\n')) {
    const section = line.match(/^###\s+(.+)\s*$/);
    if (section) {
      current = { label: section[1].trim(), links: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;

    const link = line.match(/^\s*-\s+\*\*\[([^\]]+)\]\(([^)]+\.md)\)\*\*/);
    if (!link) continue;

    const title = link[1].trim();
    const file = basename(link[2].trim());
    if (isSkippedWikiFile(file)) continue;
    if (!existsSync(join(wikiDir, file))) continue;

    const slug = wikiFileToSlug(file);
    current.links.push({
      title,
      href: `/docs/usage/${slug}/`,
      slug,
      file,
    });
  }

  return groups.filter((g) => g.links.length > 0);
}

export function listWikiPages(wikiDir: string): WikiNavLink[] {
  return parseWikiNav(wikiDir).flatMap((g) => g.links);
}

function stripExcludedWikiAnchors(html: string): string {
  return html.replace(
    /<a\s+[^>]*href=["'][^"']*Instance-manager[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    '$1',
  );
}

function rewriteHref(href: string, wikiSlugs: Set<string>): string {
  const trimmed = href.trim();

  if (/Instance-manager/i.test(trimmed)) return trimmed;

  // Explicit wiki .md relative (Getting-started.md, Foo.md#anchor)
  const mdOnly = trimmed.match(/^([A-Za-z0-9_-]+)\.md(?:#(.+))?$/);
  if (mdOnly) {
    const slug = mdOnly[1].toLowerCase();
    if (slug === 'instance-manager' || slug === 'home') return trimmed;
    const hash = mdOnly[2] ? `#${mdOnly[2]}` : '';
    return `/docs/usage/${slug}/${hash}`;
  }

  // Bare wiki page name without extension (rare)
  const bare = trimmed.match(/^([A-Za-z0-9_-]+)(?:#(.+))?$/);
  if (bare && !trimmed.includes('/') && !trimmed.includes('.')) {
    const slug = bare[1].toLowerCase();
    if (wikiSlugs.has(slug)) {
      const hash = bare[2] ? `#${bare[2]}` : '';
      return `/docs/usage/${slug}/${hash}`;
    }
  }

  // ../blob/main/...
  const blob = trimmed.match(/^\.\.\/blob\/main\/(.+)$/);
  if (blob) {
    const rest = blob[1];
    if (rest.startsWith('screenshots/')) return `/${rest}`;
    return `${GITHUB_BLOB}/${rest}`;
  }

  if (trimmed.startsWith('../') && !trimmed.startsWith('http')) {
    const rest = trimmed.replace(/^\.\.\//, '');
    if (rest.startsWith('screenshots/')) return `/${rest}`;
    if (rest.startsWith('blob/main/')) {
      const path = rest.slice('blob/main/'.length);
      if (path.startsWith('screenshots/')) return `/${path}`;
      return `${GITHUB_BLOB}/${path}`;
    }
  }

  return trimmed;
}

export function rewriteWikiHtml(html: string, wikiSlugs: Set<string>): string {
  let out = html.replace(/href=["']([^"']+)["']/gi, (_m, href: string) => {
    const next = rewriteHref(href, wikiSlugs);
    return `href="${next}"`;
  });
  out = stripExcludedWikiAnchors(out);
  return out;
}

export function loadWikiPage(
  wikiDir: string,
  slug: string,
): { title: string; html: string; file: string } | null {
  if (slug === 'instance-manager' || slug === 'home') return null;

  const pages = listWikiPages(wikiDir);
  const page = pages.find((p) => p.slug === slug);
  if (!page) return null;

  const path = join(wikiDir, page.file);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf8');
  const source = titleCaseMarkdownHeadings(raw);
  const titleMatch = source.match(/^#\s+(.+)\s*$/m);
  const title = titleMatch ? titleMatch[1].trim() : toTitleCase(page.title);
  const wikiSlugs = new Set(pages.map((p) => p.slug));
  // renderMarkdown also title-cases headings; raw is fine either way
  const html = rewriteWikiHtml(renderMarkdown(raw), wikiSlugs);

  return { title, html, file: page.file };
}
