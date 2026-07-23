import { join } from 'node:path';
import { findDocsContentRoot, findRepoRoot } from './paths';
import { renderMarkdownFile } from './render-md';
import { toTitleCase } from './title-case';
import { parseWikiNav, resolveWikiDir } from './wiki';

export type DocsNavLink = {
  title: string;
  href: string;
};

export type DocsNavSection = {
  /** Uppercase section label; omit for top-level links. */
  label?: string;
  links: DocsNavLink[];
};

export { toTitleCase } from './title-case';

export function getDocsNav(): DocsNavSection[] {
  const sections: DocsNavSection[] = [
    {
      links: [
        { title: 'Introduction', href: '/docs/' },
        { title: 'Getting Started', href: '/docs/getting-started/' },
        { title: 'FAQ', href: '/docs/faq/' },
      ],
    },
    {
      label: 'Installation',
      links: [
        { title: 'Docker', href: '/docs/installation/docker/' },
        { title: 'Docker Compose', href: '/docs/installation/docker-compose/' },
        { title: 'Manual Setup', href: '/docs/installation/manual/' },
        { title: 'Environment Variables', href: '/docs/installation/environment-variables/' },
        { title: 'Terraform', href: '/docs/installation/terraform/' },
      ],
    },
  ];

  const wikiDir = resolveWikiDir();
  if (wikiDir) {
    const usageLinks = parseWikiNav(wikiDir).flatMap((group) =>
      group.links.map((link) => ({
        title: toTitleCase(link.title),
        href: link.href,
      })),
    );
    if (usageLinks.length > 0) {
      sections.push({
        label: 'Usage',
        links: usageLinks,
      });
    }
  }

  sections.push({
    label: 'Contributing',
    links: [
      { title: 'Overview', href: '/docs/contributing/' },
      { title: 'Reporting Issues', href: '/docs/contributing/reporting-issues/' },
    ],
  });

  return sections;
}

export function loadCuratedMarkdown(relativePath: string): string {
  return renderMarkdownFile(join(findDocsContentRoot(), relativePath));
}

export function loadContributingMarkdown(): string {
  return renderMarkdownFile(join(findRepoRoot(), 'CONTRIBUTING.md'));
}

/** Flat list of curated + usage hrefs for sitemap helpers. */
export function listDocsHrefs(): string[] {
  return getDocsNav().flatMap((section) => section.links.map((link) => link.href));
}
