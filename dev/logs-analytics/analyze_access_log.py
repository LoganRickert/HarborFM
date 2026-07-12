#!/usr/bin/env python3
"""
Offline analytics for HarborFM nginx combined access logs.

Example:
  python3 analyze_access_log.py \\
    --log access.log \\
    --slug your-podcast-slug \\
    --podcast-id your-podcast-id \\
    --start 2026-01-01 --end 2026-01-14 \\
    --compare analytics.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator

LISTEN_THRESHOLD_BYTES = 250 * 1024
TINY_PROBE_BYTES = 1000

COMBINED_RE = re.compile(
    r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]*) HTTP/[0-9.]+" (\d+) (\S+) "([^"]*)" "(.*)"$'
)

MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}

# Directory / feed crawlers (map to crawler in reports)
CRAWLER_UA_RE = re.compile(
    r"|".join(
        [
            r"^Spotify/1\.0$",
            r"Amazon Music Podcast",
            r"StitcherBot",
            r"Podbean/FeedUpdate",
            r"FeedBurner",
            r"Awario",
            r"Googlebot",
            r"bingbot",
            r"Censys",
            r"zgrab",
            r"Audioscrape",
            r"FeedMaster",
            r"Tentacles",
            r"WordPress\.com",
            r"UniversalFeedParser",
            r"Podchaser",
            r"yushi-podcast",
            r"GuzzleHttp",
            r"^iTMS$",
            r"^itms$",
            r"^-$",
            r"^curl/",
            r"Go-http-client",
            r"Googlebot-Video",
            r"meta-externalagent",
            r"AhrefsBot",
            r"Baiduspider",
            r"Dataprovider",
            r"ClaudeBot",
            r"iHeartRadio",  # directory / feed agent UAs
        ]
    ),
    re.I,
)

# Known podcast listener apps (override crawler/isbot-style labels)
LISTENER_UA_RE = re.compile(
    r"|".join(
        [
            r"^Podcasts/",
            r"^Balados/",
            r"AppleCoreMedia/",
            r"^Overcast/",
            r"Overcast Player",
            r"PocketCasts/",
            r"Pocket%20Casts/",
            r"^Pocket Casts\b",
            r"Spotify/\d+\.\d+",  # real Spotify app, not Spotify/1.0 directory
            r"AntennaPod/",
            r"CastBox/",
            r"Castro\b",
            r"BeyondPod",
            r"Podkicker",
            r"Deezer Podcasts",
            r"Mozilla/5\.0 .*Safari/",  # browsers
            r"Mozilla/5\.0 .*Firefox/",
            r"Mozilla/5\.0 .*Chrome/",
        ]
    ),
    re.I,
)

SOURCE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Apple Podcasts", re.compile(r"^Podcasts/|^Balados/", re.I)),
    ("Spotify", re.compile(r"Spotify/[\d.]+", re.I)),
    ("Amazon Music", re.compile(r"Amazon Music", re.I)),
    ("Google Podcasts", re.compile(r"GooglePodcasts/|GoogleChirp|^Podcasts$", re.I)),
    (
        "Pocket Casts",
        re.compile(
            r"PocketCasts/|Pocket%20Casts/|^Pocket Casts\b|^Shifty Jelly Pocket Casts",
            re.I,
        ),
    ),
    ("Overcast", re.compile(r"^Overcast/|^Overcast\s|Overcast Player\s", re.I)),
    ("iHeartRadio", re.compile(r"iHeartRadio", re.I)),
    ("Podbean", re.compile(r"Podbean/", re.I)),
]


@dataclass
class LogEntry:
    ip: str
    day: str  # YYYY-MM-DD UTC from log timestamp
    ts: str
    method: str
    path: str
    status: int
    size: int
    referer: str
    ua: str


@dataclass
class Report:
    slug: str | None
    podcast_id: str | None
    start: str | None
    end: str | None
    parse_ok: int = 0
    parse_fail: int = 0
    rss_total: int = 0
    rss_crawler: int = 0
    rss_listener: int = 0
    rss_by_day: Counter = field(default_factory=Counter)
    rss_by_ua: Counter = field(default_factory=Counter)
    rss_by_source: Counter = field(default_factory=Counter)
    audio_total: int = 0
    audio_tiny: int = 0
    audio_ge_threshold: int = 0
    audio_by_day: Counter = field(default_factory=Counter)
    audio_by_ua: Counter = field(default_factory=Counter)
    audio_by_source: Counter = field(default_factory=Counter)
    audio_by_status: Counter = field(default_factory=Counter)
    audio_by_size_bucket: Counter = field(default_factory=Counter)
    audio_by_episode: Counter = field(default_factory=Counter)
    unique_downloads: set = field(default_factory=set)  # (day, episode_id, ip, ua)
    downloads_by_episode: Counter = field(default_factory=Counter)
    bursts: Counter = field(default_factory=Counter)  # (ts, ip) -> count


def nginx_ts_to_day(ts: str) -> str:
    # 28/Jun/2026:00:00:00 +0000
    day_s, mon, rest = ts.split("/", 2)
    year = rest[:4]
    return f"{year}-{MONTHS[mon]:02d}-{int(day_s):02d}"


def parse_size(raw: str) -> int:
    if raw == "-":
        return -1
    try:
        return int(raw)
    except ValueError:
        return -1


def traffic_class(ua: str) -> str:
    u = (ua or "").strip()
    if not u or u == "-":
        return "crawler"
    # Spotify/1.0 is directory crawler; real apps have Spotify/8.x etc.
    if re.fullmatch(r"Spotify/1\.0", u, re.I):
        return "crawler"
    if CRAWLER_UA_RE.search(u):
        return "crawler"
    if LISTENER_UA_RE.search(u):
        return "listener"
    return "crawler"


def source_from_ua(ua: str) -> str:
    u = (ua or "").strip()
    if not u:
        return "Other"
    for label, pat in SOURCE_PATTERNS:
        if pat.search(u):
            return label
    return "Other"


def size_bucket(sz: int) -> str:
    if sz < 0:
        return "unknown"
    if sz < 100:
        return "<100"
    if sz < 1000:
        return "100-1k"
    if sz < LISTEN_THRESHOLD_BYTES:
        return "1k-250k"
    return ">=250k"


def iter_entries(path: Path) -> Iterator[LogEntry | None]:
    with path.open("r", errors="replace") as f:
        for line in f:
            m = COMBINED_RE.match(line.rstrip("\n"))
            if not m:
                yield None
                continue
            ip, ts, method, req_path, status, size, ref, ua = m.groups()
            yield LogEntry(
                ip=ip,
                day=nginx_ts_to_day(ts),
                ts=ts,
                method=method,
                path=req_path.split("?", 1)[0],
                status=int(status),
                size=parse_size(size),
                referer=ref,
                ua=ua,
            )


def build_report(
    log_path: Path,
    *,
    slug: str | None,
    podcast_id: str | None,
    start: str | None,
    end: str | None,
) -> Report:
    if not slug and not podcast_id:
        raise SystemExit("Provide --slug and/or --podcast-id")

    rss_re = (
        re.compile(rf"^/api/public/podcasts/{re.escape(slug)}/rss$") if slug else None
    )
    ep_re = (
        re.compile(
            rf"^/api/{re.escape(podcast_id)}/episodes/([A-Za-z0-9_-]+)(?:\.mp3)?$"
        )
        if podcast_id
        else None
    )

    report = Report(slug=slug, podcast_id=podcast_id, start=start, end=end)

    for entry in iter_entries(log_path):
        if entry is None:
            report.parse_fail += 1
            continue
        report.parse_ok += 1
        if entry.method != "GET":
            continue
        if start and entry.day < start:
            continue
        if end and entry.day > end:
            continue

        if rss_re and rss_re.match(entry.path):
            report.rss_total += 1
            report.rss_by_day[entry.day] += 1
            report.rss_by_ua[entry.ua[:120] or "(empty)"] += 1
            report.rss_by_source[source_from_ua(entry.ua)] += 1
            if traffic_class(entry.ua) == "crawler":
                report.rss_crawler += 1
            else:
                report.rss_listener += 1

        if ep_re:
            m = ep_re.match(entry.path)
            if m:
                eid = m.group(1)
                report.audio_total += 1
                report.audio_by_day[entry.day] += 1
                report.audio_by_ua[entry.ua[:120] or "(empty)"] += 1
                report.audio_by_source[source_from_ua(entry.ua)] += 1
                report.audio_by_status[entry.status] += 1
                report.audio_by_size_bucket[size_bucket(entry.size)] += 1
                report.audio_by_episode[eid] += 1
                report.bursts[(entry.ts, entry.ip)] += 1
                if 0 <= entry.size < TINY_PROBE_BYTES:
                    report.audio_tiny += 1
                if entry.size >= LISTEN_THRESHOLD_BYTES:
                    report.audio_ge_threshold += 1
                    key = (entry.day, eid, entry.ip, entry.ua)
                    if key not in report.unique_downloads:
                        report.unique_downloads.add(key)
                        report.downloads_by_episode[eid] += 1

    return report


def report_to_dict(report: Report) -> dict[str, Any]:
    burst_ge5 = sum(1 for c in report.bursts.values() if c >= 5)
    return {
        "slug": report.slug,
        "podcast_id": report.podcast_id,
        "start": report.start,
        "end": report.end,
        "parse_ok": report.parse_ok,
        "parse_fail": report.parse_fail,
        "rss": {
            "total": report.rss_total,
            "crawler": report.rss_crawler,
            "listener": report.rss_listener,
            "crawler_pct": round(
                100 * report.rss_crawler / max(1, report.rss_total), 1
            ),
            "by_day": dict(sorted(report.rss_by_day.items())),
            "by_source": dict(report.rss_by_source.most_common()),
            "top_ua": report.rss_by_ua.most_common(20),
        },
        "audio": {
            "total_gets": report.audio_total,
            "tiny_lt_1k": report.audio_tiny,
            "ge_250kb_responses": report.audio_ge_threshold,
            "unique_downloads": len(report.unique_downloads),
            "request_vs_unique_ratio": round(
                report.audio_total / max(1, len(report.unique_downloads)), 2
            ),
            "by_day": dict(sorted(report.audio_by_day.items())),
            "by_status": dict(report.audio_by_status.most_common()),
            "by_size_bucket": dict(report.audio_by_size_bucket.most_common()),
            "by_source": dict(report.audio_by_source.most_common()),
            "top_ua": report.audio_by_ua.most_common(15),
            "top_episodes_by_request": report.audio_by_episode.most_common(20),
            "top_episodes_by_unique_download": report.downloads_by_episode.most_common(
                20
            ),
            "seconds_with_ge5_audio_gets": burst_ge5,
            "top_bursts": [
                {"ts": ts, "ip": ip, "count": c}
                for (ts, ip), c in sorted(
                    report.bursts.items(), key=lambda x: -x[1]
                )[:10]
            ],
        },
    }


def print_text_report(data: dict[str, Any]) -> None:
    rss = data["rss"]
    audio = data["audio"]
    print("=== HarborFM access log analytics ===")
    print(
        f"slug={data['slug']} podcast_id={data['podcast_id']} "
        f"range={data['start'] or '…'}..{data['end'] or '…'}"
    )
    print(f"parsed lines={data['parse_ok']} parse_fail={data['parse_fail']}")
    print()
    print("--- RSS ---")
    print(
        f"total={rss['total']} crawler={rss['crawler']} "
        f"listener={rss['listener']} crawler%={rss['crawler_pct']}"
    )
    print("by source:", rss["by_source"])
    print("top UA:")
    for ua, c in rss["top_ua"][:10]:
        print(f"  {c:6d}  {ua}")
    print()
    print("--- Audio enclosures ---")
    print(
        f"GETs={audio['total_gets']} tiny<1k={audio['tiny_lt_1k']} "
        f">=250KB responses={audio['ge_250kb_responses']} "
        f"unique downloads={audio['unique_downloads']} "
        f"inflation={audio['request_vs_unique_ratio']}x"
    )
    print("status:", audio["by_status"])
    print("size buckets:", audio["by_size_bucket"])
    print("by source:", audio["by_source"])
    print("top episodes (requests):")
    for eid, c in audio["top_episodes_by_request"][:10]:
        uniq = dict(audio["top_episodes_by_unique_download"]).get(eid, 0)
        print(f"  req={c:4d} uniq={uniq:3d}  {eid}")
    print(f"burst seconds (>=5 audio GETs): {audio['seconds_with_ge5_audio_gets']}")


def load_api_export(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def sum_api_rows(rows: Iterable[dict[str, Any]]) -> tuple[int, int, int]:
    bot = human = 0
    for r in rows:
        bot += int(r.get("bot_count", 0))
        human += int(r.get("human_count", 0))
    return bot + human, bot, human


def compare_to_api(report: Report, api: dict[str, Any], episode_titles: dict[str, str]) -> None:
    rss_t, rss_b, rss_h = sum_api_rows(api.get("rss_daily") or [])
    req_t, req_b, req_h = sum_api_rows(api.get("episode_daily") or [])
    lis_t, lis_b, lis_h = sum_api_rows(api.get("episode_listens_daily") or [])

    print()
    print("=== Compare vs analytics.json (API) ===")
    print(f"{'metric':<28} {'API':>10} {'log':>10} {'delta':>10}")
    rows = [
        ("RSS total", rss_t, report.rss_total),
        ("RSS bot/crawler", rss_b, report.rss_crawler),
        ("RSS human/listener", rss_h, report.rss_listener),
        ("Episode requests (API) / GETs", req_t, report.audio_total),
        ("Listens / unique downloads", lis_t, len(report.unique_downloads)),
    ]
    for name, api_v, log_v in rows:
        print(f"{name:<28} {api_v:10d} {log_v:10d} {log_v - api_v:10d}")

    api_req: Counter[str] = Counter()
    api_lis: Counter[str] = Counter()
    for r in api.get("episode_daily") or []:
        api_req[r["episode_id"]] += int(r.get("bot_count", 0)) + int(
            r.get("human_count", 0)
        )
    for r in api.get("episode_listens_daily") or []:
        api_lis[r["episode_id"]] += int(r.get("bot_count", 0)) + int(
            r.get("human_count", 0)
        )

    print()
    print("Per-episode (API requests / log GETs / API listens / log unique):")
    ids = sorted(
        set(api_req) | set(report.audio_by_episode) | set(api_lis) | set(report.downloads_by_episode),
        key=lambda i: -(api_req[i] + report.audio_by_episode[i]),
    )
    for eid in ids[:15]:
        title = (episode_titles.get(eid) or eid)[:48]
        print(
            f"  {api_req[eid]:3d}/{report.audio_by_episode[eid]:3d}  "
            f"{api_lis[eid]:3d}/{report.downloads_by_episode[eid]:3d}  {title}"
        )


def write_csv(report: Report, path: Path) -> None:
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["section", "key", "value"])
        w.writerow(["summary", "rss_total", report.rss_total])
        w.writerow(["summary", "rss_crawler", report.rss_crawler])
        w.writerow(["summary", "rss_listener", report.rss_listener])
        w.writerow(["summary", "audio_gets", report.audio_total])
        w.writerow(["summary", "audio_tiny", report.audio_tiny])
        w.writerow(["summary", "unique_downloads", len(report.unique_downloads)])
        for day, c in sorted(report.rss_by_day.items()):
            w.writerow(["rss_by_day", day, c])
        for day, c in sorted(report.audio_by_day.items()):
            w.writerow(["audio_by_day", day, c])
        for eid, c in report.audio_by_episode.most_common():
            w.writerow(["audio_by_episode", eid, c])
        for eid, c in report.downloads_by_episode.most_common():
            w.writerow(["unique_download_by_episode", eid, c])


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Analyze HarborFM access logs for podcast traffic")
    p.add_argument(
        "--log",
        type=Path,
        default=Path(__file__).with_name("access.log"),
        help="Path to nginx combined access.log",
    )
    p.add_argument("--slug", help="Podcast public slug (for RSS paths)")
    p.add_argument("--podcast-id", help="Podcast id (for /api/{id}/episodes/...)")
    p.add_argument("--start", help="Start date YYYY-MM-DD (inclusive, UTC log day)")
    p.add_argument("--end", help="End date YYYY-MM-DD (inclusive, UTC log day)")
    p.add_argument("--json", type=Path, help="Write full report JSON to this path")
    p.add_argument("--csv", type=Path, help="Write summary CSV to this path")
    p.add_argument(
        "--compare",
        type=Path,
        help="Path to GET /podcasts/:id/analytics JSON export to reconcile against",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.log.is_file():
        print(f"Log not found: {args.log}", file=sys.stderr)
        return 1

    slug = args.slug
    podcast_id = args.podcast_id
    episode_titles: dict[str, str] = {}

    if args.compare:
        api = load_api_export(args.compare)
        for e in api.get("episodes") or []:
            episode_titles[e["id"]] = e.get("title") or e["id"]
        # Infer id from compare file if not provided
        if not podcast_id and episode_titles:
            # podcast id is in paths; leave unset unless user passed it
            pass

    if not slug and not podcast_id:
        print("Need --slug and/or --podcast-id", file=sys.stderr)
        return 1

    report = build_report(
        args.log,
        slug=slug,
        podcast_id=podcast_id,
        start=args.start,
        end=args.end,
    )
    data = report_to_dict(report)
    print_text_report(data)

    if args.compare:
        compare_to_api(report, load_api_export(args.compare), episode_titles)

    if args.json:
        args.json.write_text(json.dumps(data, indent=2) + "\n")
        print(f"\nWrote JSON report to {args.json}")
    if args.csv:
        write_csv(report, args.csv)
        print(f"Wrote CSV report to {args.csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
