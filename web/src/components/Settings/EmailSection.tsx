import { EmailSectionProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { TestBlock } from './TestBlock';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const EMAIL_OPTIONS: ProviderOption<AppSettings['email_provider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'smtp', label: 'SMTP' },
  { value: 'sendgrid', label: 'SendGrid' },
];

export function EmailSection({
  form,
  onFormChange,
  smtpTestMutation,
  sendgridTestMutation,
  onSmtpTest,
  onSendGridTest,
}: EmailSectionProps) {
  return (
    <SectionCard
      title="Email"
      subtitle="Optional. Configure how the server sends email (e.g. for notifications or password reset). Choose None to disable."
    >
      <div className={styles.label}>
        Provider
        <ProviderToggle
          value={form.email_provider}
          options={EMAIL_OPTIONS}
          onChange={(value) => onFormChange({ email_provider: value })}
          ariaLabel="Email provider"
        />
      </div>

      {form.email_provider === 'smtp' && (
        <>
          <label className={styles.label}>
            SMTP host
            <input
              type="text"
              className={styles.input}
              placeholder="smtp.example.com"
              value={form.smtp_host}
              onChange={(e) => onFormChange({ smtp_host: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            SMTP port
            <input
              type="number"
              min={1}
              max={65535}
              step={1}
              className={styles.input}
              placeholder="587"
              value={form.smtp_port}
              onChange={(e) => onFormChange({ smtp_port: Number(e.target.value) || 587 })}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.smtp_secure}
              onChange={(e) => onFormChange({ smtp_secure: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Use TLS (recommended for port 587)</span>
          </label>
          <label className={styles.label}>
            SMTP username
            <input
              type="text"
              className={styles.input}
              placeholder="user@example.com"
              value={form.smtp_user}
              onChange={(e) => onFormChange({ smtp_user: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            SMTP password
            <input
              type="password"
              className={styles.input}
              placeholder={form.smtp_password === '(set)' ? '(saved)' : 'Enter password'}
              value={form.smtp_password === '(set)' ? '' : form.smtp_password}
              onChange={(e) => onFormChange({ smtp_password: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            From address
            <input
              type="email"
              className={styles.input}
              placeholder="noreply@example.com"
              value={form.smtp_from}
              onChange={(e) => onFormChange({ smtp_from: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>Email address used as the sender for outgoing mail.</p>
          </label>
          <TestBlock
            testMutation={smtpTestMutation}
            onTest={onSmtpTest}
            successMessage="Credentials verified."
          />
        </>
      )}

      {form.email_provider === 'sendgrid' && (
        <>
          <label className={styles.label}>
            SendGrid API key
            <input
              type="password"
              className={styles.input}
              placeholder={form.sendgrid_api_key === '(set)' ? '(saved)' : 'SG....'}
              value={form.sendgrid_api_key === '(set)' ? '' : form.sendgrid_api_key}
              onChange={(e) => onFormChange({ sendgrid_api_key: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>
              Create an API key in the{' '}
              <a
                href="https://app.sendgrid.com/settings/api_keys"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                SendGrid dashboard
              </a>
              .
            </p>
          </label>
          <label className={styles.label}>
            From address
            <input
              type="email"
              className={styles.input}
              placeholder="noreply@example.com"
              value={form.sendgrid_from}
              onChange={(e) => onFormChange({ sendgrid_from: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>Verified sender in SendGrid. Used as the sender for outgoing mail.</p>
          </label>
          <TestBlock
            testMutation={sendgridTestMutation}
            onTest={onSendGridTest}
            successMessage="API key verified."
          />
        </>
      )}

      {(form.email_provider === 'smtp' || form.email_provider === 'sendgrid') && (
        <div className={styles.emailNotifications}>
          <h3 className={styles.emailNotificationsTitle}>Email notifications</h3>
          <p className={styles.emailNotificationsIntro}>Choose which emails the server sends when email is configured.</p>
          <div className={styles.emailNotificationsFieldset} role="group" aria-label="Email notification toggles">
            <div className={styles.emailNotificationsGroup}>
              <h4 className={styles.emailNotificationsGroupTitle}>Account & sign-in</h4>
              <p className={styles.emailNotificationsGroupHelp}>Verification requires new users to confirm their email before signing in.</p>
              <div className={styles.emailNotificationsGrid}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_registration_verification}
                    onChange={(e) => onFormChange({ email_enable_registration_verification: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Verification on register</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_welcome_after_verify}
                    onChange={(e) => onFormChange({ email_enable_welcome_after_verify: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Welcome after verification</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_password_reset}
                    onChange={(e) => onFormChange({ email_enable_password_reset: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Password reset</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_admin_welcome}
                    onChange={(e) => onFormChange({ email_enable_admin_welcome: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Admin welcome (set-password)</span>
                </label>
              </div>
            </div>
            <div className={styles.emailNotificationsGroup}>
              <h4 className={styles.emailNotificationsGroupTitle}>Notifications</h4>
              <div className={styles.emailNotificationsGrid}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_new_show}
                    onChange={(e) => onFormChange({ email_enable_new_show: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>New show created</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_invite}
                    onChange={(e) => onFormChange({ email_enable_invite: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Invite to platform</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.email_enable_contact}
                    onChange={(e) => onFormChange({ email_enable_contact: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Contact form</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
