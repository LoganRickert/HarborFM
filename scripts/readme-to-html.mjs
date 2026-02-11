#!/usr/bin/env node
/**
 * Reads the local README.md and converts it to HTML with marked.
 * Run from repo root during build; image paths stay relative (screenshots/, web/public/)
 * so we copy those dirs into docs-dist and they resolve when the page is served.
 * Usage: node scripts/readme-to-html.mjs [README.md]
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const readmePath = process.argv[2] || join(repoRoot, 'README.md');

const raw = readFileSync(readmePath, 'utf-8');
marked.setOptions({ gfm: true, breaks: true });
const html = marked.parse(raw, { async: false });
process.stdout.write(html);
