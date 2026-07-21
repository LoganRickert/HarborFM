## What You Are Building

A HarborFM theme is a zip of Liquid templates, CSS, and optional images. When someone assigns it on a show, HarborFM renders those templates for the public podcast and episode pages instead of the default feed UI.

You do not write JavaScript. Interactive pieces (episode lists, player, search, dialogs) come from HarborFM mounts that you place in the markup.

Built-in **Fluid** and **Folio** already ship with HarborFM. Use this guide when you want your own look, or when you are customizing a gallery theme.

---

## Quick Start

1. Create a folder with `theme.json`, `templates/podcast.liquid`, and `templates/episode.liquid`.
2. Add CSS under `css/` if you want styles (HarborFM links every file there automatically).
3. Zip the folder so `theme.json` sits at the zip root (or one folder deep).
4. In HarborFM, open **Themes**, import the zip, then assign it under **Page Customizations** on a show.
5. Open the public feed and confirm home and an episode page look right.

Max zip size is **10 MB**.

---

## Package Layout

Put files at the zip root when you can:

```text
theme.json
templates/podcast.liquid
templates/episode.liquid
templates/_nav.liquid          # optional partial
templates/about.liquid         # optional extra page
css/theme.css                  # optional; all css/* auto-linked
images/preview.jpg             # optional gallery / picker preview
fonts/MyFace.woff2             # optional
```

A single wrapping folder is fine (`MyTheme/theme.json`, …). Import unwraps that one level.

### Required Files

- `theme.json` with `id`, `name`, and `version`
- `templates/podcast.liquid` (required even if home uses another template)
- `templates/episode.liquid`

### Allowed Paths

Import keeps only:

- `theme.json`
- `templates/*.liquid`
- `css/*` and `images/*` with allowed image extensions
- `fonts/*` with `.woff2` or `.ttf`

Allowed extensions: `.liquid`, `.css`, `.json`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.woff2`, `.ttf`

---

## Theme Manifest

`theme.json` tells HarborFM the package id, display name, version, and how pages map to URLs.

```json
{
  "id": "mytheme",
  "name": "My Theme",
  "version": "1.0.0",
  "description": "Short blurb for the Themes list and gallery cards.",
  "index": "podcast",
  "preview": "images/preview.jpg",
  "homepage": "https://app.harborfm.com/feed/preview-mytheme",
  "pages": {
    "about": "about.html"
  },
  "not_found": "not_found"
}
```

| Field | Required | What It Does |
|-------|----------|--------------|
| `id` | Yes | Stable package id. Same id updates the existing copy on re-import. Lowercase letters, numbers, `_`, `-`. |
| `name` | Yes | Name shown in HarborFM. |
| `version` | Yes | Your version string. Also used to cache-bust CSS. |
| `description` | No | One or two sentences for Themes UI cards and the docs gallery (max 280 characters). |
| `index` | No | Home template basename. Defaults to `podcast`. |
| `pages` | No | Map template basenames to public `.html` filenames. |
| `preview` | No | Path under `images/` for picker / gallery cards. |
| `homepage` | No | Public https URL (live preview or docs). |
| `not_found` | No | Template used for unknown theme pages (HTTP 404). |

Keep `id` stable when you ship updates. Bump `version` each time you re-import.

### Single-Page vs Multi-Page

- **Single-page:** one home template (often `podcast.liquid`) with the episode list and most content.
- **Multi-page:** a dedicated home template plus extra pages (about, crew, support, and so on). Give each page a clear key and label that fit the show.

`podcast.liquid` and `episode.liquid` are always required. For multi-page themes, set `index` to your home template and use `pages` to control public filenames.

Example:

```json
{
  "id": "folio",
  "name": "Folio",
  "version": "1.0.0",
  "index": "home",
  "pages": {
    "podcast": "episodes.html",
    "about": "about.html",
    "crew": "crew.html"
  }
}
```

Here `home.liquid` is the feed home, and `podcast.liquid` can still power `/episodes.html`.

### Partials

Templates that start with `_` (like `_nav.liquid`) are shared snippets, not public pages. Render them with:

```liquid
{% render '_nav', urls: urls, podcast: podcast, page: page %}
```

Pass only the variables the partial needs.

---

## How Pages Render

1. The show owner picks your theme in **Page Customizations**.
2. HarborFM picks the matching Liquid template and fills in show data.
3. Every file in `css/` is linked automatically (sorted by name), with `?v={version}`.
4. The browser hydrates interactive mounts marked with `data-harborfm-block`.

Write full HTML documents in your page templates. Share the head, nav, and footer with partials.

Images:

```liquid
<img src="{{ urls.theme_asset_base }}/images/hero.jpg" alt="" />
```

Fonts can use a relative URL from CSS (`../fonts/MyFace.woff2`) or `{{ urls.theme_asset_base }}/fonts/MyFace.woff2` from Liquid.

---

## Interactive Mounts

Place HarborFM features with `render` tags. HarborFM turns them into mount points at runtime.

```liquid
{% render 'harborfm/episodes' %}
{% render 'harborfm/search' %}
{% render 'harborfm/player' %}
```

| Mount | Typical Use |
|-------|-------------|
| `episodes` | Searchable episode list (put this on **exactly one** page) |
| `search` | Search box; usually next to `episodes` |
| `player` | Audio player on the episode page |
| `breadcrumbs` | Episode page navigation |
| `show_header` | Stock show header (optional; many themes build their own) |
| `site_header` | Platform chrome |
| `reviews` | Reviews list |
| `cast` | Hosts and guests |
| `funding` | Funding links |
| `links` | Listen / social links |
| `podroll` | Recommended shows |

Gate optional blocks with the show toggles from Page Customizations:

```liquid
{% if show.cast %}
  {% render 'harborfm/cast' %}
{% endif %}
```

For custom layout, you can loop Liquid data yourself (`cast`, `funding_links`, `links`, `podroll`, `reviews`) and only keep `harborfm/episodes` for the interactive archive.

### Action Buttons

Wire HarborFM dialogs without the stock header:

```html
<button type="button" data-harborfm-action="subscribe">Subscribe</button>
<button type="button" data-harborfm-action="share">Share</button>
<a href="{{ podcast.rss_url }}" data-harborfm-action="feed">RSS</a>
<button type="button" data-harborfm-action="message">Message</button>
<button type="button" data-harborfm-action="alerts">Alerts</button>
<button type="button" data-harborfm-action="write-review">Write a review</button>
```

Unavailable actions are hidden automatically. Style these elements however you like.

---

## Data You Can Use

### Podcast

Common fields: `title`, `description` (plain text), `author_name`, `artwork_url`, `rss_url`, `slug`.

Escape values in HTML:

```liquid
<h1>{{ podcast.title | escape }}</h1>
```

Do not use `| raw`. Descriptions are plain text; embedded HTML will not survive.

### Episodes and Episode

On home and extra pages, `episodes` is a list (`id`, `title`, `description`, `slug`, `publish_at`, `artwork_url`, `duration_seconds`). Use it for teasers if you want; prefer the `episodes` mount for the full list.

On the episode template, `episode` is the current episode (same shape as one list row).

### Accent and Show Flags

- `accent.color`, `accent.dim`, `accent.glow`, `accent.fg` come from the show’s primary color.
- `show.*` booleans mirror Page Customizations (`show.cast`, `show.funding`, `show.links`, and so on).

Map accent into CSS variables under your theme root, and set an explicit text color on accent-filled buttons (`color: var(--accent-fg)` or another checked contrast color).

### URLs

| Key | Meaning |
|-----|---------|
| `urls.home` | Feed home |
| `urls.episode` | Current episode (episode pages only) |
| `urls.theme_asset_base` | Base for theme images, fonts, and CSS |
| `urls.pages.{key}` | Extra pages from your `pages` map |

```liquid
<a href="{{ urls.home }}" {% if page == 'home' %}aria-current="page"{% endif %}>Home</a>
<a href="{{ urls.pages.about }}">About</a>
```

Only link page keys that exist in your theme.

`page` is the current template role (`home` basename, `episode`, or a custom page basename). `site.name` is the product name (HarborFM or a white-label name).

---

## Styling Tips

- Scope CSS under a root class on `<body>` (for example `.mytheme`).
- Remap HarborFM tokens (`--text`, `--bg`, `--bg-elevated`, `--text-muted`, `--border`) under that root so mounted UI matches your theme.
- Drive brand color from `accent.*` instead of hardcoding a signature green.
- Build mobile-first. Stack side rails, wrap or scroll nav, and avoid horizontal overflow under about 720px.
- Honor `prefers-reduced-motion` when you add motion.
- Put the interactive episode list on exactly one page, never both home and another archive page.

---

## Security Rules

Import **rejects** the zip if text files contain:

- `<script`
- `| raw`
- `javascript:`

Even after a successful import, HarborFM strips or rewrites other unsafe patterns (inline event handlers, dangerous URLs, path traversal in includes). Write clean HTML and CSS, and rely on mounts for interactivity.

---

## Checklist Before You Zip

- [ ] `theme.json`, `templates/podcast.liquid`, and `templates/episode.liquid` exist
- [ ] `id`, `name`, and `version` look right; `id` matches any previous import you mean to update
- [ ] Home template (`index`) exists and is not `episode` or a `_` partial
- [ ] Every `pages` key has a matching template and a valid `.html` output name
- [ ] Exactly one page includes `{% render 'harborfm/episodes' %}`
- [ ] Episode template includes `{% render 'harborfm/player' %}`
- [ ] No `<script`, `| raw`, or `javascript:` strings in theme text files
- [ ] Accent-filled buttons set an explicit contrasting text color
- [ ] Zip is under 10 MB, with `theme.json` at the root or one folder deep

Then import on **Themes**, assign under **Page Customizations**, and click through home plus one episode.

---

## Common Mistakes

| Problem | Fix |
|---------|-----|
| Import rejects the zip | Check required files, `theme.json` fields, and the security strings above |
| Re-import created a second theme | Keep the same `id` and bump `version` |
| Episode list missing or duplicated | Put `harborfm/episodes` on exactly one page |
| Extra page 404s | Confirm the template exists and `pages` / nav URLs match |
| Buttons unreadable on accent | Set `color` together with the accent background |
| Styles not updating | Bump `version` so CSS cache-busts |

---

## Bare Bones Templates

Minimum that still works: a full HTML document on each page, `harborfm/episodes` on home, and `harborfm/player` on the episode page. Pair with a `theme.json` that sets `id`, `name`, and `version` (see [Theme Manifest](#theme-manifest)).

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
<body class="barebones-theme">
  <main>
    <h1>{{ podcast.title }}</h1>
    {% if show.podcast_description %}
      <p>{{ podcast.description }}</p>
    {% endif %}
    {% render 'harborfm/search' %}
    {% render 'harborfm/episodes' %}
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
<body class="barebones-theme">
  <main>
    {% render 'harborfm/breadcrumbs' %}
    <h1>{{ episode.title }}</h1>
    {% render 'harborfm/player' %}
    {% if show.episode_description %}
      <p>{{ episode.description }}</p>
    {% endif %}
  </main>
</body>
</html>
```

From here, add CSS under `css/`, optional mounts (`show_header`, `cast`, `funding`, and so on), or extra pages. For fuller starters, download Fluid or Folio from **Themes**, or use [`theme-SKILL.md`](/web/public/theme-SKILL.md).

---

## Next Steps

- Browse ready-made packages on the [Themes gallery](/themes/).
- Download Fluid or Folio from **Themes** in your HarborFM instance and use them as references.
- If you want an agent to generate a zip for you, use [`theme-SKILL.md`](/web/public/theme-SKILL.md).
