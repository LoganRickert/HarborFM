# HarborFM access log analytics

Offline tools for reconciling nginx combined logs with HarborFM’s in-app podcast analytics.

## Files

| File | Purpose |
|------|---------|
| `analyze_access_log.py` | Stdlib CLI: RSS / audio / unique-download reports + `--compare` |
| `access.log` | Your nginx combined or Caddy JSON access log dump (**gitignored**) |
| `analytics.json` | Optional saved `GET /api/podcasts/:id/analytics` export (**gitignored**) |
| `report-*.json` / `*.csv` | Generated reports (**gitignored**) |

Do not commit access logs, analytics exports, or generated reports; they contain IPs, User-Agents, and show-specific traffic.

## Quick start

```bash
cd dev/logs-analytics

# Place your access.log (and optional analytics.json) in this directory, then:
python3 analyze_access_log.py \
  --log access.log \
  --slug your-podcast-slug \
  --podcast-id your-podcast-id \
  --start 2026-01-01 \
  --end 2026-01-14 \
  --compare analytics.json \
  --json report-out.json
```

Options:

- `--slug`: public RSS path (`/api/public/podcasts/{slug}/rss`)
- `--podcast-id`: enclosure path (`/api/{id}/episodes/{episodeId}`)
- `--start` / `--end`: UTC calendar days from the log timestamp
- `--compare`: side-by-side against a `GET /api/podcasts/:id/analytics` JSON export
- `--json` / `--csv`: write machine-readable reports

Log formats: nginx combined text, or Caddy JSON lines with `msg: "handled request"` (other Caddy operational lines are ignored).

## Metrics

| Metric | Meaning |
|--------|---------|
| Feed health (RSS) | GET `/api/public/podcasts/{slug}/rss` |
| crawler / listener | UA classification (directory agents / IVT vs podcast apps / browsers) |
| Raw fetches | GET `/api/{podcastId}/episodes/{episodeId}` (optional `.mp3`) |
| tiny &lt;1k | Response body under 1 KB (metadata probes / 304 / abort) |
| Unique downloads | Distinct `(day, episode, IP, UA)` with response size ≥ 250 KB |
| Website source | Browser UAs, or `hf_src=web` on site-player URLs (RSS enclosure stays unmarked) |

HarborFM’s in-app **Downloads** use requested Range length ≥ 250 KB plus daily client dedup (IP+UA+Accept-Language). The log approximation uses **delivered** bytes ≥ 250 KB, so totals are close but not identical.

## Compare against a product export

```bash
python3 analyze_access_log.py \
  --log ../../7-31-2026-access.log \
  --slug my-slug \
  --podcast-id Xd2BdHm__eZT63kSmHbQC \
  --start 2026-07-28 --end 2026-07-31 \
  --compare ../../analytics-2026-07-18-to-2026-07-31.json
```

Use overlapping calendar days. Product export meta now uses Downloads / Unique listeners / Feed health naming.

## Typical findings

When reconciling logs against the analytics UI, common inflation sources are:

1. **RSS directory crawlers**: flat daily volume from agents like `Spotify/1.0`, Amazon Music Podcast, Podbean FeedUpdate, StitcherBot, iTMS (feed health, not Downloads).
2. **Web feed metadata probes**: browser `preload` / tiny `Range` GETs that used to inflate raw fetches.
3. **Self / local browse traffic**: one geo or proxy IP dominating location charts when testing the public feed.

Product counters classify listener vs crawler (including Apple Watch / ListenNotes / PlayerFM IVT), skip partial Range requests under 250 KB, use feed/embed `preload="none"`, and report Downloads with Unique listeners as the primary currency.
