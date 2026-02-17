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

export function WebRTCSection({ form, onFormChange }: SettingsFormProps) {
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
          value={form.webrtc_service_url}
          onChange={(e) => onFormChange({ webrtc_service_url: e.target.value })}
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
          value={form.webrtc_public_ws_url}
          onChange={(e) => onFormChange({ webrtc_public_ws_url: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className={styles.inputHelp}>
        Public URL clients use to connect (wss:// in production). Must be reachable from browsers joining the call.
      </p>

      <label className={styles.label}>
        Recording callback secret
        <input
          type="password"
          className={styles.input}
          placeholder={form.recording_callback_secret === '(set)' ? '(saved)' : 'Shared secret for webrtc service'}
          value={form.recording_callback_secret === '(set)' ? '' : form.recording_callback_secret}
          onChange={(e) => onFormChange({ recording_callback_secret: e.target.value })}
          autoComplete="off"
        />
      </label>
      <p className={styles.inputHelp}>
        Shared secret the WebRTC service sends when a recording is ready. Set the same value as RECORDING_CALLBACK_SECRET in the webrtc container. Env var overrides this when set.
      </p>
    </SectionCard>
  );
}
