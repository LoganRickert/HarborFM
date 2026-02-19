import { EmailSectionProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { TestBlock } from './TestBlock';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const EMAIL_OPTIONS: ProviderOption<AppSettings['emailProvider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'smtp', label: 'SMTP' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'webhook', label: 'Webhook' },
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
          value={form.emailProvider}
          options={EMAIL_OPTIONS}
          onChange={(value) => onFormChange({ emailProvider: value })}
          ariaLabel="Email provider"
        />
      </div>

      {form.emailProvider === 'smtp' && (
        <>
          <label className={styles.label}>
            SMTP host
            <input
              type="text"
              className={styles.input}
              placeholder="smtp.example.com"
              value={form.smtpHost}
              onChange={(e) => onFormChange({ smtpHost: e.target.value })}
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
              value={form.smtpPort}
              onChange={(e) => onFormChange({ smtpPort: Number(e.target.value) || 587 })}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.smtpSecure}
              onChange={(e) => onFormChange({ smtpSecure: e.target.checked })}
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
              value={form.smtpUser}
              onChange={(e) => onFormChange({ smtpUser: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            SMTP password
            <input
              type="password"
              className={styles.input}
              placeholder={form.smtpPassword === '(set)' ? '(saved)' : 'Enter password'}
              value={form.smtpPassword === '(set)' ? '' : form.smtpPassword}
              onChange={(e) => onFormChange({ smtpPassword: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            From address
            <input
              type="email"
              className={styles.input}
              placeholder="noreply@example.com"
              value={form.smtpFrom}
              onChange={(e) => onFormChange({ smtpFrom: e.target.value })}
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

      {form.emailProvider === 'webhook' && (
        <>
          <label className={styles.label}>
            Webhook URL
            <input
              type="url"
              className={styles.input}
              placeholder="https://discord.com/api/webhooks/..."
              value={form.emailWebhookUrl}
              onChange={(e) => onFormChange({ emailWebhookUrl: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>
              Server POSTs JSON with one key (the field key below) and value &quot;Subject: …\n\nBody&quot;. Default <code>content</code> works with Discord.
            </p>
          </label>
          <label className={styles.label}>
            Body field key
            <input
              type="text"
              className={styles.input}
              placeholder="content"
              value={form.emailWebhookFieldKey}
              onChange={(e) => onFormChange({ emailWebhookFieldKey: e.target.value })}
              autoComplete="off"
            />
            <p className={styles.inputHelp}>
              JSON key for the message content. Use <code>content</code> for Discord webhooks.
            </p>
          </label>
        </>
      )}

      {form.emailProvider === 'sendgrid' && (
        <>
          <label className={styles.label}>
            SendGrid API key
            <input
              type="password"
              className={styles.input}
              placeholder={form.sendgridApiKey === '(set)' ? '(saved)' : 'SG....'}
              value={form.sendgridApiKey === '(set)' ? '' : form.sendgridApiKey}
              onChange={(e) => onFormChange({ sendgridApiKey: e.target.value })}
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
              value={form.sendgridFrom}
              onChange={(e) => onFormChange({ sendgridFrom: e.target.value })}
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

      {(form.emailProvider === 'smtp' || form.emailProvider === 'sendgrid' || form.emailProvider === 'webhook') && (
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
                    checked={form.emailEnableRegistrationVerification}
                    onChange={(e) => onFormChange({ emailEnableRegistrationVerification: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Verification on register</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.emailEnableWelcomeAfterVerify}
                    onChange={(e) => onFormChange({ emailEnableWelcomeAfterVerify: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Welcome after verification</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.emailEnablePasswordReset}
                    onChange={(e) => onFormChange({ emailEnablePasswordReset: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Password reset</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.emailEnableAdminWelcome}
                    onChange={(e) => onFormChange({ emailEnableAdminWelcome: e.target.checked })}
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
                    checked={form.emailEnableNewShow}
                    onChange={(e) => onFormChange({ emailEnableNewShow: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>New show created</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.emailEnableInvite}
                    onChange={(e) => onFormChange({ emailEnableInvite: e.target.checked })}
                  />
                  <span className="toggle__track" aria-hidden="true" />
                  <span>Invite to platform</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.emailEnableContact}
                    onChange={(e) => onFormChange({ emailEnableContact: e.target.checked })}
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
