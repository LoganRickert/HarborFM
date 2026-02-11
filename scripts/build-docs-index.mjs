#!/usr/bin/env node
/**
 * Build docs-dist/index.html: HarborFM theme + local README converted to HTML.
 * Run from repo root after docs-dist/ exists and screenshots/web/public are copied.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const readmePath = join(repoRoot, 'README.md');
const outPath = join(repoRoot, 'docs-dist', 'index.html');

const raw = readFileSync(readmePath, 'utf-8');
marked.setOptions({ gfm: true, breaks: true });
marked.use(gfmHeadingId()); // add id to headings for #anchor links
const readmeHtml = marked.parse(raw, { async: false });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HarborFM Docs</title>
  <meta name="description" content="HarborFM — open source podcast creation tool. Build episodes from segments, export RSS and audio. Documentation and API reference." />
  <meta name="theme-color" content="#00d4aa" />
  <link rel="icon" type="image/png" href="./web/public/favicon.png" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="HarborFM Docs" />
  <meta property="og:description" content="HarborFM — open source podcast creation tool. Build episodes from segments, export RSS and audio." />
  <meta property="og:image" content="./web/public/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="HarborFM Docs" />
  <meta name="twitter:description" content="HarborFM — open source podcast creation tool. Build episodes from segments, export RSS and audio." />
  <meta name="twitter:image" content="./web/public/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0c0e12;
      --bg-elevated: #14171e;
      --text: #e8eaef;
      --text-muted: #8b92a3;
      --accent: #00d4aa;
      --accent-dim: #00a884;
      --border: #2a2f3d;
      --font-sans: 'DM Sans', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, monospace;
      --max-content: 900px;
    }
    * { box-sizing: border-box; }
    html { font-size: 16px; -webkit-font-smoothing: antialiased; }
    body { margin: 0; font-family: var(--font-sans); background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }
    .header { background: var(--bg-elevated); border-bottom: 1px solid var(--border); padding: 1rem 1.5rem; }
    .header-inner { max-width: var(--max-content); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
    .header h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
    .header a { color: var(--accent); text-decoration: none; }
    .header a:hover { text-decoration: underline; opacity: 0.9; }
    .nav a { margin-left: 1rem; }
    .main { max-width: var(--max-content); margin: 0 auto; padding: 2rem 1.5rem; }
    .main a { color: var(--accent); text-decoration: underline; }
    .main a:hover { opacity: 0.9; }
    .main h1, .main h2, .main h3 { margin-top: 1.5em; margin-bottom: 0.5em; }
    .main h1 { font-size: 1.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
    .main h2 { font-size: 1.35rem; }
    .main h3 { font-size: 1.1rem; }
    .main pre, .main code { font-family: var(--font-mono); font-size: 0.9em; background: var(--bg-elevated); color: var(--text); }
    .main pre { padding: 1rem; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); }
    .main code { padding: 0.15em 0.4em; border-radius: 4px; }
    .main pre code { padding: 0; background: none; }
    .main img { max-width: 100%; height: auto; }
    .main ul, .main ol { padding-left: 1.5rem; }
    .main blockquote { margin: 1em 0; padding-left: 1em; border-left: 4px solid var(--accent); color: var(--text-muted); }
    .main table { border-collapse: collapse; width: 100%; }
    .main th, .main td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
    .main th { background: var(--bg-elevated); }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <h1><a href="./">HarborFM</a></h1>
      <nav class="nav">
        <a href="./server/">API (OpenAPI / Swagger)</a>
        <a href="https://github.com/LoganRickert/harborfm">GitHub</a>
      </nav>
    </div>
  </header>
  <main class="main">
${readmeHtml}
  </main>
</body>
</html>
`;

writeFileSync(outPath, html, 'utf-8');
console.log('Wrote docs-dist/index.html (local README + theme)');
