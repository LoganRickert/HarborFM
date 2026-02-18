# Changelog

## v1.3 - 2026-02-17

- **Segment editor:** Trim ranges and markers (non-destructive); "Add Silence Trims" to auto-detect 1s+ silence and add trim ranges with buffer; marker type (None/Chapter) and color picker; "Server Remove Silence" and noise suppression in Functions tab; waveform shows trimmed regions collapsed and hides trimmed sections.
- **Episode chapters:** View Chapters card below Generate Final bar; add, edit, delete chapters with color picker; play from chapter time (seeks and starts playback when paused); chapter markers on final episode waveform (editor, feed, embed).
- **Podcast 2.0 chapters:** `chapters.json` generated when chapters exist; `<podcast:chapters>` in RSS; regenerated on render and chapter edit/delete; same access control as episode MP3; included in S3/deploy exports.
- **Episode transcript:** Generate Transcript only shown when transcript provider is configured; upload SRT when generate is unavailable; scrollable transcript box; PATCH transcript with size/validity checks.
- **Delete episode:** Red "Delete Episode" button at bottom of More tab (owner/admin only); confirm dialog; on confirm deletes episode and navigates to episodes list.
- **Backend episodes list:** Sorted by publish date (created_at fallback); grouped into Draft, Scheduled, Published sections; status badge shows date when `publish_at` set, else status label.
- **Publish transition:** When changing status from draft/scheduled to published, `publish_at` auto-set to now if null or empty.
- **Subscriber only fix:** Episodes with no audio and `subscriber_only` 0 now show "Audio not available" instead of "Subscriber Only" (FeedEpisode, EmbedEpisode, FeedEpisodeCard).
- **Feed page episodes:** Episodes list sorts by publish date.
- **Title trim:** Episode and podcast titles trimmed on create/edit.
- **Delete podcast:** "Delete podcast" in More tab of podcast details (owner/admin only); confirm dialog; background deletion with polling (removes all episodes, audio, transcripts, waveforms, RSS, artwork); navigates to dashboard when done.
- **Ollama API:** Fixed endpoints to use `/api/generate` and `/api/tags` (Ollama expects the `/api/` prefix).
- **LLM Ask:** Richer context-segment name, markers, duration; improved prompt for speaking-pattern feedback and follow-up questions for future segments.
- **Transcript editor:** Updated to support trim feature-soft delete adds entry to trim ranges, trimmed entries show collapsed with restore; Save persists trim ranges; Ask tab excludes trimmed text from LLM context.
- **2FA extensibility:** Enabled methods are now a list (TOTP, email) in settings.
- **Login 2FA (email):** Code is sent automatically when 2FA method is email; "Send code" is a gray secondary button below Verify with 30s cooldown.
- **Caddy:** Fixed Caddy failing when not using WebRTC.

## v1.2 - 2026-02-16

- **Group call improvements:** Group chat during calls; call settings panel (mic selector, auto gain control, listen-to-self, volume); redesigned soundboard panel with waveform preview and search; wake lock on mobile to prevent screen sleep during calls; dedicated join-by-code page for guests.
- **Real-time episode collaboration:** WebSocket for episode editing; collaborators receive live updates for segment add/update/delete/reorder, call start/end, episode updates, render progress, and transcript generation.
- **Segment editor:** Batched waveform fetching (10 at a time) with in-memory cache to avoid rate limits; WebSocket integration for live segment updates.
- **Podcast details:** Expand/collapse for podcast metadata on the podcast page.
- **Terraform deployment:** AWS and Vultr Terraform scripts to provision VMs; user-data script for PM2, nginx, Let's Encrypt, optional WebRTC; Cloudflare DNS integration.
- **Setup from scripts:** Seed script for automated initial setup (`ADMIN_EMAIL`, `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH_B64`); supports Terraform user-data and headless install.
- **Install & docs:** Updated install and update script paths; Terraform quick start and README; optional `WEBRTC_ENABLED` flag.

## v1.1 - 2026-02-13

- **Cast (hosts & guests):** Add cast members to podcasts and episodes; assign hosts and guests per episode; episode cast shown on public feed; cast list filters out already-assigned members.
- **Listen on & Follow links:** Per-podcast links for Apple Podcasts, Spotify, Amazon Music, and other platforms; social links (X, Facebook, Instagram, TikTok, YouTube).
- **Share & embed:** Share button on episode page with share dialog and embed options.
- **Analytics:** Improved analytics view page.
- **Public feed:** Episode list supports pagination, server-side search, and sort (newest/oldest).
- **Dashboard sort:** Podcast list now sorts by `created_at` instead of `updated_at` for newest/oldest.
- **Seed script:** `pnpm run db:seed-podcast-episodes` to create a podcast with 100 episodes and cast assignments.
- **Docs & install:** Updated documentation; note for `COOKIE_SECURE=false` when using HTTP; install and update script fixes.

## v1.0 - 2026-02-13

Officially version 1.0!

## v0.9 - 2026-02-12

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
