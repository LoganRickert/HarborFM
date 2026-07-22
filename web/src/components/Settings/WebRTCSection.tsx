import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

const WEBRTC_SUBTITLE = (
  <>
    Configure the optional WebRTC service for group calls and server-side recording. When both service URL and public WebSocket URL are set, hosts can start group calls with audio. Leave blank to disable.
    {' '}
    <a
      href="https://github.com/versatica/mediasoup"
      target="_blank"
      rel="noopener noreferrer"
      className={styles.link}
    >
      Mediasoup
    </a>
    {' '}
    runs in a separate Docker service (profile webrtc).
  </>
);

/** Hostname without TLD for Telnyx SIP subdomain (e.g. studio.example.com → studio-example). */
function sipSubdomainFromHostname(raw: string): string {
  let host = raw.trim();
  if (!host) return '';
  try {
    if (/^https?:\/\//i.test(host)) {
      host = new URL(host).hostname;
    } else {
      host = host.split('/')[0]?.split(':')[0] ?? host;
    }
  } catch {
    host = host.split('/')[0]?.split(':')[0] ?? host;
  }
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length === 0) return '';
  if (labels.length === 1) {
    return labels[0].replace(/[^a-z0-9-]/g, '');
  }
  return labels
    .slice(0, -1)
    .join('-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

export function WebRTCSection({ form, onFormChange }: SettingsFormProps) {
  const [webhookCopied, setWebhookCopied] = useState(false);
  const hostname = (form.hostname || '').trim();
  const publicBase = hostname
    ? hostname.startsWith('http')
      ? hostname.replace(/\/$/, '')
      : `https://${hostname}`
    : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  const dialInWebhookUrl = publicBase
    ? `${publicBase}/api/call/dial-in/webhook`
    : '/api/call/dial-in/webhook';
  const recommendedSipSubdomain = sipSubdomainFromHostname(
    hostname || (typeof window !== 'undefined' ? window.location.hostname : ''),
  );

  const copyWebhookUrl = () => {
    void navigator.clipboard.writeText(dialInWebhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 1000);
  };

  return (
    <SectionCard
      title="WebRTC (Group Calls & Recording)"
      subtitle={WEBRTC_SUBTITLE}
    >
      <label className={styles.label}>
        Service URL
        <input
          type="url"
          className={styles.input}
          placeholder="http://webrtc:3002"
          value={form.webrtcServiceUrl}
          onChange={(e) => onFormChange({ webrtcServiceUrl: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className={styles.inputHelp}>
        Internal URL to reach the WebRTC service (e.g. in Docker: http://webrtc:3002). Used to create mediasoup rooms.
      </p>

      <label className={styles.label}>
        Public WebSocket URL
        <input
          type="url"
          className={styles.input}
          placeholder="wss://example.com/webrtc-ws or ws://localhost:3002"
          value={form.webrtcPublicWsUrl}
          onChange={(e) => onFormChange({ webrtcPublicWsUrl: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className={styles.inputHelp}>
        Public URL clients use to connect (wss:// in production). Must be reachable from browsers joining the call.
        Defaults to the app hostname + /webrtc-ws; when you change Hostname in Access, this updates if it still matched the old host.
      </p>

      <label className={styles.label}>
        Recording callback secret
        <input
          type="password"
          className={styles.input}
          placeholder={form.recordingCallbackSecret === '(set)' ? '(saved)' : 'Shared secret for webrtc service'}
          value={form.recordingCallbackSecret === '(set)' ? '' : form.recordingCallbackSecret}
          onChange={(e) => onFormChange({ recordingCallbackSecret: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className={styles.inputHelp}>
        Shared secret the WebRTC service sends when a recording is ready. Set the same value as RECORDING_CALLBACK_SECRET in the webrtc container. Env var overrides this when set.
      </p>

      <h3 className={styles.label} style={{ marginTop: '1.5rem' }}>Phone Dial-in</h3>
      <p className={styles.inputHelp}>
        Let guests join group calls by phone using the same 4-digit join code shown in the call panel.
      </p>

      <label className="toggle" data-settings-label="Enable phone dial-in">
        <input
          type="checkbox"
          checked={Boolean(form.dialInEnabled)}
          onChange={(e) => onFormChange({ dialInEnabled: e.target.checked })}
          data-testid="settings-dial-in-enabled"
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Phone Dial-in</span>
      </label>
      <p className={styles.toggleHelp}>
        When enabled and a phone number is set, hosts see dial-in details and phone admissions are allowed.
      </p>

      {form.dialInEnabled && (
        <>
          <label className={styles.label} data-settings-label="Dial-in phone number">
            Dial-in Phone Number
            <input
              type="tel"
              className={styles.input}
              placeholder="+1 555 555 0100"
              value={form.dialInPhoneNumber}
              onChange={(e) => onFormChange({ dialInPhoneNumber: e.target.value })}
              autoComplete="off"
              data-testid="settings-dial-in-phone-number"
            />
          </label>
          <p className={styles.inputHelp}>
            Number callers dial. Shown to hosts and on the guest join page when dial-in is enabled.
          </p>

          <label className={styles.label} data-settings-label="Recording consent prompt">
            Recording Consent Prompt
            <textarea
              className={styles.input}
              rows={2}
              placeholder="This call may be recorded. Stay on the line to join HarborFM."
              value={form.dialInConsentPrompt}
              onChange={(e) => onFormChange({ dialInConsentPrompt: e.target.value })}
              data-testid="settings-dial-in-consent-prompt"
            />
          </label>
          <p className={styles.inputHelp}>
            Spoken before a phone caller is bridged into the call.
          </p>

          <label className="toggle" data-settings-label="Prefer HD voice">
            <input
              type="checkbox"
              checked={Boolean(form.dialInHdVoice)}
              onChange={(e) => onFormChange({ dialInHdVoice: e.target.checked })}
              data-testid="settings-dial-in-hd-voice"
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Prefer HD Voice</span>
          </label>
          <p className={styles.toggleHelp}>
            When on, HarborFM asks Telnyx for L16 at 16 kHz on the media bridge (wideband).
            When off, uses PCMU at 8 kHz. Phone-to-Telnyx HD still needs G722 on your Connection
            and carrier HD Voice / VoLTE on the caller&apos;s phone. Rebuild/restart webrtc-service
            after changing this so the bridge matches the wire format.
          </p>

          <label className={styles.label} data-settings-label="Telnyx API key">
            Telnyx API Key
            <input
              type="password"
              className={styles.input}
              placeholder={form.telnyxApiKey === '(set)' ? '(saved)' : 'API key'}
              value={form.telnyxApiKey === '(set)' ? '' : form.telnyxApiKey}
              onChange={(e) => onFormChange({ telnyxApiKey: e.target.value })}
              autoComplete="off"
              data-testid="settings-telnyx-api-key"
            />
          </label>
          <p className={styles.inputHelp}>
            Optional until live PSTN. Create a key in the{' '}
            <a
              href="https://portal.telnyx.com/#/app/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              Telnyx API Keys
            </a>{' '}
            page.
          </p>

          <label className={styles.label} data-settings-label="Telnyx public key">
            Telnyx Public Key
            <input
              type="password"
              className={styles.input}
              placeholder={
                form.telnyxPublicKey === '(set)' ? '(saved)' : 'Base64 Ed25519 public key'
              }
              value={form.telnyxPublicKey === '(set)' ? '' : form.telnyxPublicKey}
              onChange={(e) => onFormChange({ telnyxPublicKey: e.target.value })}
              autoComplete="off"
              data-testid="settings-telnyx-public-key"
            />
          </label>
          <p className={styles.inputHelp}>
            Required for live dial-in. HarborFM uses it to verify Telnyx webhook
            signatures. Copy the base64 public key from{' '}
            <a
              href="https://portal.telnyx.com/#/api-keys/public-key"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              Mission Control, Public Key
            </a>
            .
          </p>

          <label className={styles.label} data-settings-label="Telnyx connection ID">
            Telnyx Connection ID (Application ID)
            <input
              type="text"
              className={styles.input}
              placeholder="Voice API Application ID"
              value={form.telnyxConnectionId}
              onChange={(e) => onFormChange({ telnyxConnectionId: e.target.value })}
              autoComplete="off"
              data-testid="settings-telnyx-connection-id"
            />
          </label>
          <p className={styles.inputHelp}>
            Same value as the Voice API Application ID in Mission Control. Telnyx APIs still call it{' '}
            <code>connection_id</code> (legacy name). Copy it from your app under{' '}
            <a
              href="https://portal.telnyx.com/#/app/call-control/applications"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              Programmable Voice
            </a>
            . See{' '}
            <a
              href="https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              Voice API setup
            </a>
            .
          </p>

          <div className={styles.callbackUrlCard} data-settings-label="Telnyx webhook URL">
            <p className={styles.callbackUrlLabel}>Telnyx webhook URL</p>
            <div className={styles.callbackUrlRow}>
              <p className={styles.callbackUrlValue} data-testid="settings-dial-in-webhook-url">
                {dialInWebhookUrl}
              </p>
              <button
                type="button"
                className={styles.callbackUrlCopyBtn}
                onClick={copyWebhookUrl}
                title={webhookCopied ? 'Copied' : 'Copy to clipboard'}
                aria-label={webhookCopied ? 'Copied' : 'Copy webhook URL'}
              >
                {webhookCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className={styles.dialInHintNote}>
              Paste this as the webhook URL on your Voice API Application.
              {!hostname
                ? ' Set Hostname under Access for the correct public URL (use a tunnel for local).'
                : ' Telnyx needs a public HTTPS URL that reaches this instance.'}
            </p>
          </div>

          <div className={styles.callbackUrlCard}>
            <p className={styles.callbackUrlLabel}>Recommended Telnyx app settings</p>
            <dl className={styles.dialInSettingsList}>
              <div className={styles.dialInSettingsRow}>
                <dt>Enable hang-up on timeout</dt>
                <dd>On</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Hang-up timeout</dt>
                <dd>30 seconds</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Custom webhook timeout</dt>
                <dd>10 seconds</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>DTMF Type</dt>
                <dd>RFC 2833</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Enable RTCP capture</dt>
                <dd>Off</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Enable Call Cost</dt>
                <dd>Off</dd>
              </div>
            </dl>
          </div>

          <div className={styles.callbackUrlCard}>
            <p className={styles.callbackUrlLabel}>Recommended inbound settings</p>
            <dl className={styles.dialInSettingsList}>
              <div className={styles.dialInSettingsRow}>
                <dt>SIP subdomain</dt>
                <dd>{recommendedSipSubdomain || 'your-hostname'}</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>SIP subdomain receive settings</dt>
                <dd>From Anyone</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Inbound Channel Limit</dt>
                <dd>Blank or 10</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Enable SHAKEN/STIR headers</dt>
                <dd>Off</dd>
              </div>
              <div className={styles.dialInSettingsRow}>
                <dt>Codecs</dt>
                <dd>G722, G711U, G711A (G722 first for HD)</dd>
              </div>
            </dl>
            <p className={styles.dialInHintNote}>
              SIP subdomain is your Access hostname without the TLD (becomes{' '}
              <code>
                {(recommendedSipSubdomain || 'your-hostname')}.sip.telnyx.com
              </code>
              ). Uncheck VP8 and H.264. Leave G729, OPUS, and AMR-WB unchecked.
              Prefer HD Voice above controls the HarborFM↔Telnyx media stream; Connection codecs
              control the phone↔Telnyx leg.
            </p>
          </div>
        </>
      )}
    </SectionCard>
  );
}
