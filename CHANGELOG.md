# Changelog

## v1.0.0 - 2026-02-13

Officially version 1.0!

## v0.9.0 - 2026-02-12

- **API keys:** Optional name and expiry (`valid_until`); can be disabled or restricted to a `valid_from` datetime.
- **Subscription tokens:** Per-podcast tokenized RSS for private or subscriber-only feeds; optional validity window and per-user limit on tokens.
- **Subscriber-only episodes:** Episodes can be marked subscriber-only (excluded from public RSS, only in tokenized feed).
- **Automatic DNS:** Podcasts can use a managed domain or sub-domain with optional Cloudflare API key (encrypted) for custom feed URLs.
- **Per-user transcription:** Users can have transcription permission toggled (`can_transcribe`); admins control who can use Whisper.
- **Podcast limits:** Podcast `max_episodes` now follows the owner’s current limit (no longer frozen at creation time).
- **Public feed toggle:** Per-podcast option to disable the public RSS and public episode list (404 when disabled).
- **Episode GUIDs:** GUIDs are unique per podcast to satisfy feed validators.
- **Contact form:** Contact messages with optional context; messages stored and optionally emailed to admins.
- **Collaborators & invites:** Podcast sharing with view/editor/manager roles; max collaborators limit; platform invites for new users.
- **User limits & read-only:** Per-user limits for podcasts, episodes, storage; read-only accounts.
- **Password reset & email verification:** Reset tokens and verification flow; forgot-password attempt tracking.
- **Export config:** Unified export config with encrypted credentials; bucket/region/endpoint and mode support.
- **Podcast stats & GeoIP:** RSS and episode stats (hits, listens, location); optional GeoLite2.

## [66ff470] - 2026-02-11

- Added ability to have collaborators. Fixed styling issues. Moved around some envs.
- Fixed UI style issue on mobile with profile page. Fixed episode generator missing when read-only.
- Redacted location when read-only. Added captcha to password reset.
- Hide location data if account is read only.
- Fixed install script not loading correct install dir.
- Fixed db migration issue.

## [5e03378] - 2026-02-10

- Removed console logging for username/emails.
- Fixed github action issue.
- Disabled logging nginx health check on docker compose.
- Squashed commits. Added Profile page, added contact page, added readonly user, added new export features, added API keys, added contact page.
- Fixed several styling bugs and issues.
- Fixing install script again.
- Fixing install script again.
- Fixed mkdir docker data.
- Install script logs grabs the setup id for user.
- Fixed build.

## [ec9ed1e] - 2026-02-09

- Fixed lint issues.
- Squashed commits. Added docker compose. Added email verification. Added captcha. Added user limits. Added podcast stats. Added copyright information. Added geoip information.
- Fixed the Dockerfile.
- Revise README.md for improved project description.
- Added GeoLite2 feature. Added Privacy and Terms page.
- Added a lot of library improvements.

## [d2b3709] - 2026-02-08

- Fixed tab order.
- Added ability to upload images for episodes instead of just urls.
- Fixed scrolling of popups.
- Fixed restarting after pausing.
- Added the waveform to the feed page.
- Redesigned the breadcrumb and fixed styling issues.
- Changed safeImageSrc.
- Fixed refresh issues and changed rate limiting.
- Updated buttons.
- Fixed scrolling issues on popup menus.
- Added the ability to upload a podcast photo.
- Updated the dashboard.
- Updated the buttons on the podcasts page.
- Refactored Episode Editor.
- Updated readme.
- Moved secrets to its own container. Added ability to mark asset as global.
- Added rate limiting.
- Fixed ollama base URL issue.
- Fixed security issues.
- Added an edit podcast dialog.
- Changed the segment builder.
- Fixed audio streaming issues.
- Potential fix for code scanning alert no. 80: Server-side request forgery.

## [67740e4] - 2026-02-07

- Fixed another safari seeking issue.
- Fixed Safari loading segment issue.
- Added note not to navigate away lol.
- Fixed phone going to sleep while recording.
- Updated the readme.
- More sqlite3 issues.
- Upgraded better sqlite3.
- Added a pnpm rebuild.
- Sqlite3 continues to not work right.
- Changed build information.
- Changed package versions.
- Added chevron to episodes.
- Fixed segments not using memo.
- Added memo to library.
- Defined mask css property.
- Bumped pnpm version.
- Fixed github actions hopefully.
- Fixed readme typo.
- Added PWA. Fixed favicon. Fixed audio not being sent right when not mp3.
- First public commit.
