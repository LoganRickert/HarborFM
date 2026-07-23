import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Astro may rewrite import.meta.url at build time; try several roots. */
export function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../..'),
    join(process.cwd(), '..'),
    process.cwd(),
  ];
  for (const root of candidates) {
    if (existsSync(join(root, 'package.json')) && existsSync(join(root, 'docs'))) {
      return root;
    }
  }
  return join(here, '../../..');
}

export function findDocsContentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../markdown/docs'),
    join(process.cwd(), 'src/markdown/docs'),
    join(process.cwd(), 'docs/src/markdown/docs'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return join(here, '../markdown/docs');
}
