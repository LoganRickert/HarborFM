#!/usr/bin/env bash
set -euo pipefail

# Build static API docs for GitHub Pages.
# Layout: docs-dist/index.html (landing), docs-dist/server/ (Swagger UI + openapi.json).
# Run from repo root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 1) Generate OpenAPI spec (builds server if needed, starts it, curls, stops)
if [[ ! -f openapi.json ]] || [[ server/dist/app.js -nt openapi.json ]]; then
  pnpm run build
  bash scripts/build-openapi.sh
fi

# 2) Prepare output
rm -rf docs-dist
mkdir -p docs-dist/server

# 3) Copy Swagger UI static assets into server/
cp -R node_modules/swagger-ui-dist/* docs-dist/server/

# 4) Copy spec and point Swagger UI at it
cp openapi.json docs-dist/server/openapi.json
cat > docs-dist/server/swagger-initializer.js <<'EOF'
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: "./openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    layout: "StandaloneLayout",
  });
};
EOF

# 5) Copy local README-referenced assets so relative paths (screenshots/, web/public/) resolve
mkdir -p docs-dist/screenshots docs-dist/web/public
cp -r screenshots/. docs-dist/screenshots/ 2>/dev/null || true
cp -r web/public/. docs-dist/web/public/ 2>/dev/null || true
cp LICENSE docs-dist/ 2>/dev/null || true

# 6) Convert local README to HTML and build themed index (writes docs-dist/index.html)
node scripts/build-docs-index.mjs

# 7) SEO: robots.txt and sitemap.xml (base URL for docs site)
DOCS_BASE_URL="${DOCS_BASE_URL:-https://docs.harborfm.com}"
cat > docs-dist/robots.txt <<EOF
User-agent: *
Allow: /

Sitemap: ${DOCS_BASE_URL}/sitemap.xml
EOF
cat > docs-dist/sitemap.xml <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${DOCS_BASE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${DOCS_BASE_URL}/server/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
EOF

echo "Docs built in docs-dist/ (root index + server/)"
