import { AccessGeneralSectionProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function AccessGeneralSection({
  form,
  onFormChange,
  welcomeBannerRef,
  onResizeWelcomeBanner,
}: AccessGeneralSectionProps) {
  return (
    <SectionCard
      title="Access & General"
      subtitle="Control who can sign up, whether public feeds are visible, and general server settings."
    >
      <label className="toggle" data-settings-label="Enable Account Registration">
        <input
          type="checkbox"
          checked={form.registrationEnabled}
          onChange={(e) => onFormChange({ registrationEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Account Registration</span>
      </label>
      <p className={styles.toggleHelp}>
        When enabled, new users can create accounts. When disabled, only existing users can log in.
      </p>

      <label className="toggle" data-settings-label="Enable Public Feeds">
        <input
          type="checkbox"
          checked={form.publicFeedsEnabled}
          onChange={(e) => onFormChange({ publicFeedsEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Public Feeds</span>
      </label>
      <p className={styles.toggleHelp}>
        When disabled, public feed pages and RSS endpoints are hidden and require login to access the app.
      </p>

      <label className="toggle" data-settings-label="Enable Cookie / Tracking Consent Banner">
        <input
          type="checkbox"
          checked={form.gdprConsentBannerEnabled}
          onChange={(e) => onFormChange({ gdprConsentBannerEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Cookie / Tracking Consent Banner</span>
      </label>
      <p className={styles.toggleHelp}>
        Show cookie/tracking consent banner on public feed and embed pages. When enabled, visitors see a GDPR-style banner before optional analytics/tracking. Off by default.
      </p>

      <label className={styles.label} data-settings-label="Hostname">
        Hostname
        <input
          type="url"
          className={styles.input}
          placeholder="https://example.com"
          value={form.hostname}
          onChange={(e) => onFormChange({ hostname: e.target.value })}
        />
        <p className={styles.inputHelp}>
          Base URL for RSS feed enclosures when hosting audio files on this server. Used if no S3 export is configured.
          Changing this also updates the WebRTC public WebSocket URL when it still pointed at the previous hostname.
        </p>
      </label>

      <label className={styles.label} data-settings-label="White Label">
        White Label
        <input
          type="text"
          className={styles.input}
          placeholder="HarborFM"
          value={form.whiteLabel}
          onChange={(e) => onFormChange({ whiteLabel: e.target.value })}
        />
        <p className={styles.inputHelp}>
          When set, replaces &quot;HarborFM&quot; on public feed headers, episode pages, and embeds. Leave empty to use the default name.
        </p>
      </label>

      <label className="toggle" data-settings-label="Enable WebSub Discovery">
        <input
          type="checkbox"
          checked={form.websubDiscoveryEnabled}
          onChange={(e) => onFormChange({ websubDiscoveryEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable WebSub Discovery</span>
      </label>

      {form.websubDiscoveryEnabled && (
        <label className={styles.label}>
          WebSub Discovery
          <input
            type="url"
            className={styles.input}
            placeholder="https://pubsubhubbub.appspot.com/"
            value={form.websubHub}
            onChange={(e) => onFormChange({ websubHub: e.target.value })}
          />
          <p className={styles.inputHelp}>
            When set, the feed XML includes a WebSub hub link (rel="hub") so hubs can discover and subscribe to feed updates.
          </p>
        </label>
      )}

      <label className={styles.label} data-settings-label="Welcome Banner">
        Welcome Banner
        <textarea
          ref={welcomeBannerRef}
          className={styles.input}
          rows={1}
          placeholder="Optional message above the sign in form..."
          value={form.welcomeBanner}
          onChange={(e) => onFormChange({ welcomeBanner: e.target.value })}
          onInput={onResizeWelcomeBanner}
        />
        <p className={styles.inputHelp}>
          Shown above the sign in form. New lines are preserved. Leave empty to hide.
        </p>
      </label>
    </SectionCard>
  );
}
