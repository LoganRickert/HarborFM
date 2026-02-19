import {
  TWO_FACTOR_METHODS,
  parseTwoFactorMethods,
  serializeTwoFactorMethods,
} from '@harborfm/shared';
import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

export function TwoFactorSection({ form, onFormChange }: SettingsFormProps) {
  const emailConfigured =
    form.emailProvider === 'smtp' ||
    form.emailProvider === 'sendgrid' ||
    form.emailProvider === 'webhook';

  const currentMethods = parseTwoFactorMethods(form.twoFactorMethods);

  const handleMethodChange = (methodId: string, checked: boolean) => {
    let next = [...currentMethods];
    if (checked) {
      if (!next.includes(methodId)) next.push(methodId);
    } else {
      next = next.filter((m) => m !== methodId);
    }
    onFormChange({
      twoFactorMethods: serializeTwoFactorMethods(next),
    });
  };

  return (
    <SectionCard
      title="Two-Factor Authentication"
      subtitle="When enabled, users can add two-factor authentication via TOTP (authenticator app) and optionally email. If enforced, users without 2FA must add it after signing in with password."
    >
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.twoFactorEnabled}
          onChange={(e) => onFormChange({ twoFactorEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable 2FA</span>
      </label>
      <p className={styles.toggleHelp}>
        When enabled, users can add 2FA from their Profile using any allowed method below.
      </p>

      {form.twoFactorEnabled && (
        <>
          <div className={styles.label}>
            Allowed methods
          </div>
          {TWO_FACTOR_METHODS.map((method) => {
            const isChecked = currentMethods.includes(method.id);
            const needsProvider = method.requiresProvider !== null;
            const providerConfigured =
              method.requiresProvider === 'email' ? emailConfigured : true;
            const disabled = needsProvider && !providerConfigured;

            return (
              <div key={method.id}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleMethodChange(method.id, e.target.checked)}
                    disabled={disabled}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>{method.label}</span>
                </label>
                <p className={styles.toggleHelp}>
                  {disabled && method.requiresProvider === 'email'
                    ? `Configure an email provider above (SMTP, SendGrid, or Webhook) to enable ${method.label}.`
                    : method.description}
                </p>
              </div>
            );
          })}

          <label className="toggle">
            <input
              type="checkbox"
              checked={form.twoFactorEnforced}
              onChange={(e) => onFormChange({ twoFactorEnforced: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Enforce 2FA</span>
          </label>
          <p className={styles.toggleHelp}>
            When enabled, users without 2FA must add it after successfully entering their password.
          </p>
        </>
      )}
    </SectionCard>
  );
}
