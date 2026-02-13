import { SettingsFormProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const CAPTCHA_OPTIONS: ProviderOption<AppSettings['captcha_provider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'hcaptcha', label: 'hCaptcha' },
  { value: 'recaptcha_v2', label: 'Google v2' },
  { value: 'recaptcha_v3', label: 'Google v3' },
];

const CAPTCHA_SUBTITLE = (
  <>
    Optional. When enabled, users must complete a CAPTCHA when signing in or registering.{' '}
    Get keys from <a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener noreferrer" className={styles.link}>Google reCAPTCHA</a>
    {' or '}
    <a href="https://dashboard.hcaptcha.com/" target="_blank" rel="noopener noreferrer" className={styles.link}>hCaptcha</a>.
  </>
);

export function CaptchaSection({ form, onFormChange }: SettingsFormProps) {
  return (
    <SectionCard
      title="CAPTCHA (Sign-In & Registration)"
      subtitle={CAPTCHA_SUBTITLE}
    >
      <div className={styles.label}>
        Provider
        <ProviderToggle
          value={form.captcha_provider}
          options={CAPTCHA_OPTIONS}
          onChange={(value) => onFormChange({ captcha_provider: value })}
          ariaLabel="CAPTCHA provider"
        />
      </div>
      {form.captcha_provider !== 'none' && (
        <>
          <label className={styles.label}>
            Site key
            <input
              type="text"
              className={styles.input}
              placeholder={
                form.captcha_provider.startsWith('recaptcha')
                  ? '6Lc...'
                  : 'Paste your site key from the provider dashboard'
              }
              value={form.captcha_site_key}
              onChange={(e) => onFormChange({ captcha_site_key: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            Secret key
            <input
              type="password"
              className={styles.input}
              placeholder={form.captcha_secret_key === '(set)' ? '(saved)' : 'Paste your secret key'}
              value={form.captcha_secret_key === '(set)' ? '' : form.captcha_secret_key}
              onChange={(e) => onFormChange({ captcha_secret_key: e.target.value })}
              autoComplete="off"
            />
          </label>
        </>
      )}
    </SectionCard>
  );
}
