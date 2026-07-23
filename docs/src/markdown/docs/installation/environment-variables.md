# Environment Variables

HarborFM is configured mainly via environment variables. Below are the essentials; the full table is in the [README](https://github.com/LoganRickert/harborfm/blob/main/README.md#docker-environment-variables).

## Essential for Production

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Required for signing sessions; use a long random string (for example `openssl rand -base64 32`). |
| `HARBORFM_SECRETS_KEY` | Optional; encrypts export credentials and Stripe credential packs (base64/base64url). Set if you use Podcast Delivery or Stripe. |
| `DATA_DIR` | DB, uploads, processed audio, RSS, artwork, library, page themes (Docker often `/data`). |
| `SECRETS_DIR` | JWT and secrets key files (Docker often `/secrets`). Can be omitted if secrets are passed via env. |

## Server and Paths

- `PORT` (default `3001`), `HOST` (default `0.0.0.0`)
- `PUBLIC_DIR` - static web app directory
- `NODE_ENV` - set to `production` in production (affects CORS and cookie Secure default)

## Cookies and HTTPS

- `COOKIE_SECURE` - set `true` when using HTTPS
- For **http** only, set `COOKIE_SECURE=false`

## WebRTC (Group Calls)

- `WEBRTC_ENABLED` - `1` or `true` to enable
- `WEBRTC_SERVICE_URL` - internal URL to the webrtc service (for example `http://webrtc:3002`)
- `WEBRTC_PUBLIC_WS_URL` - public WebSocket URL for clients (for example `wss://example.com/webrtc-ws`)
- `WEBRTC_SERVICE_SECRET`, `RECORDING_CALLBACK_SECRET` - app ↔ webrtc auth
- `MEDIASOUP_ANNOUNCED_IP` - public IP when behind NAT

## More Options

The README table also covers upload size limits, ffmpeg/ffprobe/audiowaveform paths, GeoIP, Whisper/LLM, email, captcha, rate limits, bootstrap admin vars (`SETUP_ID`, `ADMIN_EMAIL`, …), and Stripe/DNS AAD settings.

## See Also

- [Docker](/docs/installation/docker/)
- [Docker Compose](/docs/installation/docker-compose/)
- [Terraform](/docs/installation/terraform/)
- [Usage: Deployment](/docs/usage/deployment/)
