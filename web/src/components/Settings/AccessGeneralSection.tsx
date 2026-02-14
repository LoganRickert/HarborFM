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
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.registration_enabled}
          onChange={(e) => onFormChange({ registration_enabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Account Registration</span>
      </label>
      <p className={styles.toggleHelp}>
        When enabled, new users can create accounts. When disabled, only existing users can log in.
      </p>

      <label className="toggle">
        <input
          type="checkbox"
          checked={form.public_feeds_enabled}
          onChange={(e) => onFormChange({ public_feeds_enabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Public Feeds</span>
      </label>
      <p className={styles.toggleHelp}>
        When disabled, public feed pages and RSS endpoints are hidden and require login to access the app.
      </p>

      <label className="toggle">
        <input
          type="checkbox"
          checked={form.gdpr_consent_banner_enabled}
          onChange={(e) => onFormChange({ gdpr_consent_banner_enabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Cookie / Tracking Consent Banner</span>
      </label>
      <p className={styles.toggleHelp}>
        Show cookie/tracking consent banner on public feed and embed pages. When enabled, visitors see a GDPR-style banner before optional analytics/tracking. Off by default.
      </p>

      <label className={styles.label}>
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
        </p>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={form.websub_discovery_enabled}
          onChange={(e) => onFormChange({ websub_discovery_enabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable WebSub Discovery</span>
      </label>

      {form.websub_discovery_enabled && (
        <label className={styles.label}>
          WebSub Discovery
          <input
            type="url"
            className={styles.input}
            placeholder="https://pubsubhubbub.appspot.com/"
            value={form.websub_hub}
            onChange={(e) => onFormChange({ websub_hub: e.target.value })}
          />
          <p className={styles.inputHelp}>
            When set, the feed XML includes a WebSub hub link (rel="hub") so hubs can discover and subscribe to feed updates.
          </p>
        </label>
      )}

      <label className={styles.label}>
        Welcome Banner
        <textarea
          ref={welcomeBannerRef}
          className={styles.input}
          rows={1}
          placeholder="Optional message above the sign in form..."
          value={form.welcome_banner}
          onChange={(e) => onFormChange({ welcome_banner: e.target.value })}
          onInput={onResizeWelcomeBanner}
        />
        <p className={styles.inputHelp}>
          Shown above the sign in form. New lines are preserved. Leave empty to hide.
        </p>
      </label>
    </SectionCard>
  );
}
