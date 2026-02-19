import { SettingsFormProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const CAPTCHA_OPTIONS: ProviderOption<AppSettings['captchaProvider']>[] = [
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
          value={form.captchaProvider}
          options={CAPTCHA_OPTIONS}
          onChange={(value) => onFormChange({ captchaProvider: value })}
          ariaLabel="CAPTCHA provider"
        />
      </div>
      {form.captchaProvider !== 'none' && (
        <>
          <label className={styles.label}>
            Site key
            <input
              type="text"
              className={styles.input}
              placeholder={
                form.captchaProvider.startsWith('recaptcha')
                  ? '6Lc...'
                  : 'Paste your site key from the provider dashboard'
              }
              value={form.captchaSiteKey}
              onChange={(e) => onFormChange({ captchaSiteKey: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            Secret key
            <input
              type="password"
              className={styles.input}
              placeholder={form.captchaSecretKey === '(set)' ? '(saved)' : 'Paste your secret key'}
              value={form.captchaSecretKey === '(set)' ? '' : form.captchaSecretKey}
              onChange={(e) => onFormChange({ captchaSecretKey: e.target.value })}
              autoComplete="off"
            />
          </label>
        </>
      )}
    </SectionCard>
  );
}
