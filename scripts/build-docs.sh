#!/usr/bin/env bash
set -euo pipefail

# Build docs site for GitHub Pages.
# Layout: docs-dist/ = Astro site (index + pages); docs-dist/server/ = Swagger UI + openapi.json.
# Run from repo root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 1) Generate OpenAPI spec (builds server if needed, starts it, curls, stops)
if [[ ! -f openapi.json ]] || [[ server/dist/app.js -nt openapi.json ]]; then
  pnpm run build
  bash scripts/build-openapi.sh
fi

# 2) Build Astro docs site (outputs to docs-dist/)
rm -rf docs-dist
ASTRO_TELEMETRY_DISABLED=1 pnpm --filter harborfm-docs run build

# 3) Add Swagger UI and OpenAPI spec under server/
mkdir -p docs-dist/server
cp -R node_modules/swagger-ui-dist/* docs-dist/server/
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

# 4) Copy assets for any pages that reference them (screenshots, web/public, LICENSE)
mkdir -p docs-dist/screenshots docs-dist/web/public
cp -r screenshots/. docs-dist/screenshots/ 2>/dev/null || true
cp -r web/public/. docs-dist/web/public/ 2>/dev/null || true
cp LICENSE docs-dist/ 2>/dev/null || true

# 5) SEO: robots.txt and sitemap.xml (base URL for docs site)
DOCS_BASE_URL="${DOCS_BASE_URL:-https://harborfm.com}"

# Collect static marketing URLs plus every built HTML page under docs/
SITEMAP_PATHS=(
  "/"
  "/features/"
  "/themes/"
  "/theme-guide/"
  "/updates/"
  "/server/"
)

if [[ -d docs-dist/docs ]]; then
  while IFS= read -r -d '' html; do
    rel="${html#docs-dist}"
    rel="${rel%/index.html}"
    if [[ "$rel" == "/index.html" || "$rel" == "" ]]; then
      path="/docs/"
    else
      path="${rel}/"
    fi
    # Avoid duplicates
    skip=0
    for existing in "${SITEMAP_PATHS[@]}"; do
      if [[ "$existing" == "$path" ]]; then skip=1; break; fi
    done
    if [[ $skip -eq 0 ]]; then
      SITEMAP_PATHS+=("$path")
    fi
  done < <(find docs-dist/docs -type f -name 'index.html' -print0 | sort -z)
fi

{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
EOF
  for path in "${SITEMAP_PATHS[@]}"; do
    priority="0.7"
    changefreq="weekly"
    case "$path" in
      /) priority="1.0" ;;
      /features/) priority="0.9" ;;
      /docs/) priority="0.9" ;;
      /themes/|/server/) priority="0.8" ;;
      /theme-guide/) priority="0.75" ;;
    esac
    cat <<EOF
  <url>
    <loc>${DOCS_BASE_URL}${path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
EOF
  done
  echo '</urlset>'
} > docs-dist/sitemap.xml

cat > docs-dist/robots.txt <<EOF
User-agent: *
Allow: /

Sitemap: ${DOCS_BASE_URL}/sitemap.xml
EOF

echo "Docs built in docs-dist/ (Astro site + server/)"
