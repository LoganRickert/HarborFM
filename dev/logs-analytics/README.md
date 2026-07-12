# HarborFM access log analytics

Offline tools for reconciling nginx combined logs with HarborFM’s in-app podcast analytics.

## Files

| File | Purpose |
|------|---------|
| `analyze_access_log.py` | Stdlib CLI: RSS / audio / unique-download reports + `--compare` |
| `access.log` | Your nginx combined access log dump (**gitignored**) |
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

## Metrics

| Metric | Meaning |
|--------|---------|
| RSS total | GET `/api/public/podcasts/{slug}/rss` |
| crawler / listener | UA classification (directory agents vs podcast apps / browsers) |
| Audio GETs | GET `/api/{podcastId}/episodes/{episodeId}` (optional `.mp3`) |
| tiny &lt;1k | Response body under 1 KB (metadata probes / 304 / abort) |
| unique downloads | Distinct `(day, episode, IP, UA)` with response size ≥ 250 KB |

Harbor’s in-app **listens** use requested Range length ≥ 250 KB plus daily client dedup (IP+UA+Accept-Language). The log approximation uses **delivered** bytes ≥ 250 KB, so totals are close but not identical.

## Typical findings

When reconciling logs against the analytics UI, common inflation sources are:

1. **RSS directory crawlers**: flat daily volume from agents like `Spotify/1.0`, Amazon Music Podcast, Podbean FeedUpdate, StitcherBot, iTMS (not the same as listener downloads).
2. **Web feed metadata probes**: browser `preload` / tiny `Range` GETs that used to inflate episode “requests.”
3. **Self / local browse traffic**: one geo or proxy IP dominating location charts when testing the public feed.

Product counters (forward-looking) classify listener vs crawler, skip partial Range requests under 250 KB (full-file GETs still count as requests), use feed/embed `preload="none"`, and label Listeners / Crawlers with a listener-primary overview.
