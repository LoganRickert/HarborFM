# HarborFM feed theme skill

Create a complete, importable HarborFM Liquid theme package. Always include valid `theme.json`, `templates/podcast.liquid`, and `templates/episode.liquid`; use Harbor mounts for interactive features; validate the package against every hard requirement below; and return the finished ZIP.

HarborFM themes are **not** full static sites. They are Liquid HTML shells. Interactive pieces (episode list, player, reviews, cast, funding, links, search, and so on) are injected by HarborFM into mount points you place in templates.

---

## Assistant procedure

Follow this order every time:

1. **Decide layout:** single-page (one home template with most mounts) or multi-page (dedicated home + extra `.html` pages).
2. **Choose a stable theme `id`:** lowercase `^[a-z0-9][a-z0-9_-]*$`, max 64. Reuse the same id when updating.
3. **Generate all required files** (see Output contract), then optional CSS/images/extra templates.
4. **Validate** with the deterministic checks below. Fix failures before packaging.
5. **Package the ZIP** using the canonical zip layout.
6. **Respond** with the deliverables listed in the Output contract, plus any assumptions you made (brand colors, page set, fonts).

Do not invent Harbor APIs, client-side script, or undocumented Liquid variables.

---

## Default decisions

Use these defaults unless the request specifies otherwise:

- Use a single-page theme for a straightforward podcast site.
- Use a multi-page theme when separate About, Cast, Support, or Contact pages are requested or have substantial content.
- Make a reasonable visual direction without unnecessary follow-up questions.
- Use a mobile-first layout and scope CSS under a theme-specific root class.
- Reuse the existing `id` for updates and increment `version` when shipping an update.

---

## Output contract

When asked to generate a theme, always produce:

1. **A downloadable `.zip`** that imports on the Themes page (primary deliverable).
2. **An unpacked file tree** (or equivalent listing) showing every path in the zip.
3. **A short summary** that states:
   - theme `id`, `name`, `version`
   - single-page vs multi-page
   - which Harbor blocks were placed where
   - assumptions (palette, typography, extra pages)
4. **A validation result**, such as `Validation: 9/9 checks passed`.

Unpacked files alone are not enough unless the user explicitly asks not to zip.

---

## Canonical package layout

**Preferred (canonical):** put package files at the **zip root**:

```text
theme.json
templates/podcast.liquid
templates/episode.liquid
templates/…                 # optional
css/….css                   # optional; all auto-linked
images/…                    # optional
```

**Accepted alternative:** one wrapping directory is OK (`MyTheme/theme.json`, …). Import strips a single top-level folder when `theme.json` is not at the zip root. Prefer the flat zip root so tooling and humans see the same tree.

Max zip size: **10 MB**.

---

## Requirement levels

| Level | Meaning |
|-------|---------|
| **Import requirement** | Zip is rejected if missing/invalid. |
| **Usability baseline** | Not import-enforced, but a complete listener experience requires it. |
| **Recommended** | Quality / maintainability; not enforced by import. |

### Import requirements

- `theme.json` with valid `id`, `name`, `version`
- `templates/podcast.liquid` (even if `index` is another template)
- `templates/episode.liquid`
- Template basenames: `_?[a-z0-9][a-z0-9_-]*`
- `index` (if set) exists, is not `episode`, is not a `_` partial
- `pages` keys exist as templates; values match `^[a-z0-9][a-z0-9_-]*\.html$`; no `episode` / partials / index overrides
- Only allowed paths/extensions (see Allowed files)
- No rejected security constructs (see Security)
- Zip ≤ 10 MB

### Usability baseline

- Home template includes working Harbor mounts for core listening UX (at least `show_header` + `episodes`; usually `search` too)
- Episode template includes `player` (and usually `breadcrumbs` / title)
- CSS lives under `css/` if you want host auto-linking
- Nav links use `urls.home` and `urls.pages.*` for real keys only

### Recommended conventions

- Scope all CSS under a body/root class (e.g. `.mytheme`)
- Set `--accent`, `--accent-dim`, `--accent-glow` from `accent.*`
- Treat `--accent` as a color token, not an automatic button theme. Every accent-filled control must explicitly set a contrasting foreground color in the same selector.
- Gate optional mounts with `show.*`
- Prefer `{% render 'harborfm/…' %}` over hand-rolled episode lists
- Keep `id` stable across revisions; bump `version` on each ship
- Mobile-first layout; avoid generic purple-on-white AI chrome unless requested

---

## `theme.json`

```json
{
  "id": "mytheme",
  "name": "My Theme",
  "version": "1.0.0",
  "description": "Short blurb for Themes UI cards and the docs gallery.",
  "index": "podcast",
  "pages": {
    "about": "about.html"
  }
}
```

| Field | Required | Rules |
|-------|----------|--------|
| `id` | yes | Package id. `^[a-z0-9][a-z0-9_-]*$`, max 64. Same id updates the user's copy on re-import. |
| `name` | yes | Display name, 1–120 chars. |
| `version` | yes | String, 1–64 chars. Also used as CSS cache-bust (`?v=`). |
| `description` | no | Plain-text blurb for Themes UI / gallery cards, 1–280 chars. |
| `index` | no | Home template basename. Default `podcast`. |
| `pages` | no | Extra template → public `.html` filename overrides. |
| `allowOverride` | no | Harbor-managed for server themes. Omitted/true: image upgrades may replace the data copy when `version` changes. `false`: skip seed overwrite (set automatically after admin edits or promote). Do not set this in author zips. |

### Extra pages

Every non-partial, non-`episode`, non-index template becomes a public page (default `{basename}.html`, overridable via `pages`).

Multi-page example:

```json
{
  "id": "folio",
  "name": "Folio",
  "version": "1.0.0",
  "index": "home",
  "pages": {
    "podcast": "episodes.html",
    "about": "about.html",
    "crew": "crew.html",
    "support": "support.html",
    "connect": "connect.html"
  }
}
```

`home.liquid` is feed home; `podcast.liquid` remains required and can be mapped to `episodes.html`.

### Allowed files

Import keeps only:

- `theme.json`
- `templates/*.liquid` (one segment under `templates/`)
- `css/*` and `images/*` with allowed extensions

Extensions: `.liquid` `.css` `.json` `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg`

Junk (`__MACOSX`, `.DS_Store`, `._*`) is ignored.

---

## Security: reject vs sanitize

### Rejected on import (hard fail)

These strings in text files (`.liquid`, `.css`, `.json`) and `.svg` files cause import to fail:

| Construct | Error idea |
|-----------|------------|
| `<script` | Script tags are not allowed |
| `\| raw` | The `\| raw` filter is not allowed |
| `javascript:` | javascript: URLs are not allowed |

Do not ship these. Fix them before packaging.

### Sanitized (stripped or rewritten)

Even when import succeeds, HarborFM rewrites unsafe bits on write/render:

| Construct | Behavior |
|-----------|----------|
| `<script>…</script>` | Removed |
| `on*=` event attributes | Removed |
| `javascript:` in href/src/action | Rewritten to `#blocked:` |
| `data:text/html` in href/src | Rewritten to `#blocked:` |
| `\| raw` | Replaced with `\| escape` |
| `{% include/render … '..' %}` path traversal | Neutralized |

Prefer never relying on sanitization. Write clean HTML + CSS and Harbor mounts only.

### HTML escaping and descriptions

- Do not assume ordinary Liquid `{{ value }}` output is escaped automatically. Use `{{ value | escape }}` for dynamic values in HTML text or attribute contexts where escaping matters.
- Do **not** use `| raw`.
- `podcast.description` and episode descriptions are provided as **plain text** (HTML already stripped server-side). Do not expect embedded markup to survive.

---

## How rendering works

1. Owner selects the Liquid theme in Page Customizations (not the default SPA theme).
2. HarborFM renders the matching Liquid template to HTML.
3. Every file in `css/` is auto-linked (sorted by name) with `?v={version}`.
4. The client hydrates `[data-harborfm-block="…"]` mounts.

Write full HTML documents in page templates. Share chrome with partials:

```liquid
{% render '_head', accent: accent %}
```

You do **not** need `<link>` tags for files under `css/`. Critical accent vars may live in a small `<style>` block.

Images: `{{ urls.theme_asset_base }}/images/your.png`.

---

## Harbor blocks

Insert mounts with:

```liquid
{% render 'harborfm/episodes' %}
```

→ `<div data-harborfm-block="episodes"></div>`

| Block | Role | Level |
|-------|------|--------|
| `show_header` | Show title / artwork / subscribe | Runtime (home) |
| `episodes` | Episode list | Runtime (home / archive) |
| `search` | Episode search | Recommended with `episodes` |
| `player` | Audio player | Runtime (episode) |
| `breadcrumbs` | Episode crumb nav | Recommended (episode) |
| `site_header` | Platform chrome | Recommended |
| `reviews` | Reviews | Recommended; gate with `show.reviews_*` |
| `cast` | Hosts / guests | Recommended; gate with `show.cast` |
| `funding` | Funding | Recommended; gate with `show.funding` |
| `links` | Platform links | Recommended; gate with `show.links` |
| `podroll` | Recommended shows | Recommended; gate with `show.podroll` |

```liquid
{% if show.cast %}
  {% render 'harborfm/cast' %}
{% endif %}
```

On episode pages use `show.reviews_episode` and `show.episode_description`.

---

## Liquid context

### `podcast`

| Key | Type | Notes |
|-----|------|--------|
| `title` | string | |
| `description` | string | Plain text |
| `author_name` | string | |
| `artwork_url` | string \| empty | |
| `rss_url` | string | |
| `slug` | string | |

### `episodes` (home / extra pages)

`id`, `title`, `description`, `slug`, `publish_at`, `artwork_url`, `duration_seconds`

Prefer `harborfm/episodes` over custom loops.

### `episode` (episode template)

Same shape as one episodes row.

### `accent`

`id`, `color`, `dim`, `glow` - map to CSS variables.

### `show` (booleans)

`author`, `podcast_description`, `episode_description`, `funding`, `reviews_podcast`, `reviews_episode`, `podroll`, `cast`, `links`

### `urls`

| Key | Meaning |
|-----|---------|
| `home` / `podcast` | Feed home (`/feed/{slug}` or `/` on custom domain) |
| `episode` | Current episode URL (episode render only) |
| `theme_asset_base` | Asset base for css/images |
| `pages.{template}` | Extra page URLs |

### `site.name`

Product / site display name.

### `page`

Logical role: home template basename, `episode`, or custom page basename (for active nav).

```liquid
<a href="{{ urls.home }}" {% if page == 'home' %}aria-current="page"{% endif %}>Home</a>
```

---

## Patterns

### Partials

```liquid
{% render '_nav', urls: urls, podcast: podcast, site: site, page: page %}
```

Pass only variables the partial needs. Leading `_` = not a public page.

### Multi-page nav

```liquid
<a href="{{ urls.home }}">Home</a>
<a href="{{ urls.pages.podcast }}">Episodes</a>
<a href="{{ urls.pages.about }}">About</a>
```

Only link keys that exist.

### Scoped CSS

```html
<body class="mytheme">
```

```css
.mytheme a { color: var(--accent); }
```

### Accent buttons and contrast

Do not create a control with both:

```css
background: var(--accent);
color: var(--accent);
```

The generic theme link rule often uses `color: var(--accent)`, so an accent-filled link or injected HarborFM control can inherit accent-colored text unless its foreground is explicitly overridden.

For every accent-filled button or button-like link, set `background`, `color`, and hover `color` together. Use a dark foreground only after checking that the accent is light enough; otherwise use a light foreground.

```css
.mytheme .button--primary,
.mytheme [data-harborfm-block] .button--primary {
  background: var(--accent);
  color: #101612;
  border-color: transparent;
}

.mytheme .button--primary:hover,
.mytheme [data-harborfm-block] .button--primary:hover {
  background: color-mix(in srgb, var(--accent) 82%, white);
  color: #101612;
}
```

If an accent could be dark, use a theme foreground variable that has been visually checked against all supported accent colors instead of assuming black or white works universally. Verify normal, hover, focus, and disabled states for buttons and injected HarborFM controls.

---

## Minimal starter (single-page)

### `theme.json`

```json
{
  "id": "starter",
  "name": "Starter",
  "version": "1.0.0"
}
```

### `templates/podcast.liquid`

```liquid
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{ podcast.title }} | {{ site.name }}</title>
  <style>
    :root {
      --accent: {{ accent.color }};
      --accent-dim: {{ accent.dim }};
      --accent-glow: {{ accent.glow }};
    }
  </style>
</head>
<body class="starter-theme">
  {% render 'harborfm/site_header' %}
  <main>
    {% render 'harborfm/show_header' %}
    {% if show.podcast_description %}
      <p>{{ podcast.description }}</p>
    {% endif %}
    {% render 'harborfm/search' %}
    {% render 'harborfm/episodes' %}
    {% if show.cast %}{% render 'harborfm/cast' %}{% endif %}
    {% if show.funding %}{% render 'harborfm/funding' %}{% endif %}
    {% if show.links %}{% render 'harborfm/links' %}{% endif %}
    {% if show.podroll %}{% render 'harborfm/podroll' %}{% endif %}
    {% if show.reviews_podcast %}{% render 'harborfm/reviews' %}{% endif %}
  </main>
</body>
</html>
```

### `templates/episode.liquid`

```liquid
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{ episode.title }} | {{ podcast.title }}</title>
  <style>
    :root {
      --accent: {{ accent.color }};
      --accent-dim: {{ accent.dim }};
      --accent-glow: {{ accent.glow }};
    }
  </style>
</head>
<body class="starter-theme">
  {% render 'harborfm/site_header' %}
  <main>
    {% render 'harborfm/breadcrumbs' %}
    <h1>{{ episode.title }}</h1>
    {% render 'harborfm/player' %}
    {% if show.episode_description %}
      <p>{{ episode.description }}</p>
    {% endif %}
    {% if show.reviews_episode %}{% render 'harborfm/reviews' %}{% endif %}
  </main>
</body>
</html>
```

### `css/starter.css`

Layout and typography under `.starter-theme`. Mobile-first.

For multi-page themes: set `index`, keep `podcast.liquid`, add page templates, share `_nav` / `_head` / `_footer`, place mounts per page. Reference **Fluid** (single-page) or **Folio** (multi-page) server theme zips when adapting.

---

## Deterministic validation (run before packaging)

Treat any failure as a blocker and report the completed checks in the final response.

1. **Required paths:** Confirm `theme.json`, `templates/podcast.liquid`, and `templates/episode.liquid` exist.
2. **Manifest:** Parse `theme.json`; confirm `id`, `name`, and `version` meet their length and format rules.
3. **Routing:** Confirm an `index`, if set, has a matching template and is not `episode` or a partial. Confirm every `pages` key has a template, every page output is a valid `.html` filename, and no output filenames duplicate.
4. **Files:** Confirm every retained path and extension is allowed, and every template basename matches the required pattern.
5. **Security:** Scan every `.liquid`, `.css`, `.json`, and `.svg` file for:
   - `<script`
   - `| raw` (with optional spaces around `|`)
   - `javascript:`
6. **Usability:** Confirm the home template contains `harborfm/show_header` and `harborfm/episodes`, and `templates/episode.liquid` contains `harborfm/player`.
7. **Contrast:** Confirm accent-filled buttons and button-like links set an explicit contrasting `color` in normal and hover states. Do not rely on the generic link color.
8. **Size:** Confirm the ZIP is no larger than 10 MB.
9. **ZIP structure:** Confirm `theme.json` is at zip root, or exactly one wrapping directory contains it directly.

Optional smoke checks: open Templates page import after download; assign in Page Customizations; load feed home and one episode.

---

## Packaging workflow (human or agent)

1. Build the tree (canonical flat layout).
2. Run validation.
3. Zip; confirm `theme.json` at root (or one folder deep).
4. Import on Themes.
5. Assign in Page Customizations; set accent and `show.*` toggles.
6. Verify mounts and CSS on the public feed.
7. Iterate by bumping `version` and re-importing the same `id`.

In-app theme editor can also edit templates, CSS, and routing after import.

---

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| Import rejected | Missing required files, invalid `theme.json`, rejected constructs, oversize zip |
| Missing in show picker | Using server id instead of imported copy, or import failed |
| Blank interactive areas | Missing `{% render 'harborfm/…' %}` |
| Broken nav | Wrong / missing `urls.pages` key |
| Styles missing | CSS not under `css/`, or unscoped selectors |
| Episode template 404 | Missing `templates/episode.liquid` |

---

## Do not

- Build a React app or ship theme JavaScript
- Call private Harbor APIs from the theme
- Omit `podcast` / `episode` templates
- Use `episode` as `index` or a public `pages` entry
- Expose `_` partials as public pages
- Change `id` when you mean to update an existing package
