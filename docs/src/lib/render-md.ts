import { existsSync, readFileSync } from 'node:fs';
import { marked } from 'marked';
import { titleCaseMarkdownHeadings } from './title-case';

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdownFile(path: string): string {
  if (!existsSync(path)) {
    return '<p>Content not found.</p>';
  }
  try {
    const source = titleCaseMarkdownHeadings(readFileSync(path, 'utf8'));
    return marked.parse(source, { async: false }) as string;
  } catch {
    return '<p>Failed to load content.</p>';
  }
}

export function renderMarkdown(source: string): string {
  try {
    return marked.parse(titleCaseMarkdownHeadings(source), { async: false }) as string;
  } catch {
    return '<p>Failed to render content.</p>';
  }
}
