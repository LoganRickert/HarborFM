import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TWO_FACTOR_METHODS, parseTwoFactorMethods, isMethodAllowed } from '@harborfm/shared';
import { setupStatus } from '../../api/setup';
import {
  startTOTPSetup,
  confirmTOTPSetup,
  startEmail2FA,
  confirmEmail2FA,
  disable2FA,
} from '../../api/auth';
import type { TwoFactorStatus } from '../../api/auth';
import { Shield, Mail, X, ChevronRight, Check, ShieldOff } from 'lucide-react';
import { OtpInput } from '../OtpInput/OtpInput';
import styles from '../../pages/Profile.module.css';

interface Props {
  twoFactor: TwoFactorStatus | null | undefined;
  hasEmail?: boolean;
  /** False for federated accounts (no password). */
  hasPassword?: boolean;
}

export function TwoFactorProfileSection({ twoFactor, hasEmail = true, hasPassword = true }: Props) {
  const queryClient = useQueryClient();
  const { data: setup } = useQuery({
    queryKey: ['setupStatus'],
    queryFn: setupStatus,
    staleTime: 60_000,
  });
  const allowedMethods = parseTwoFactorMethods(setup?.twoFactorMethods);
  const twoFactorEnabled =
    setup?.twoFactorEnabled ??
    setup?.twoFactorEnforced ??
    (allowedMethods.length > 0);
  const emailConfigured = Boolean(setup?.emailConfigured);

  /** Methods available for adding (implemented + allowed + provider if needed). */
  const availableMethods = TWO_FACTOR_METHODS.filter((m) => {
    if (!twoFactorEnabled || !isMethodAllowed(allowedMethods, m.id)) return false;
    if (m.requiresProvider === 'email') return emailConfigured && hasEmail;
    return true;
  });
  const totp2FAAvailable = availableMethods.some((m) => m.id === 'totp');
  const email2FAAvailable = availableMethods.some((m) => m.id === 'email');

  const [totpStep, setTotpStep] = useState<'idle' | 'password' | 'confirm'>('idle');
  const [emailStep, setEmailStep] = useState<'idle' | 'sent' | 'confirm'>('idle');
  const [disableStep, setDisableStep] = useState<'idle' | 'password' | 'code' | 'send-email'>('idle');

  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);

  const startTotpMutation = useMutation({
    mutationFn: () => startTOTPSetup(password),
    onSuccess: (data) => {
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setSetupToken(data.setupToken);
      setTotpStep('confirm');
      setPassword('');
    },
  });

  const confirmTotpMutation = useMutation({
    mutationFn: () => confirmTOTPSetup(setupToken!, code, secret!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setTotpStep('idle');
      setCode('');
      setQrDataUrl(null);
      setSecret(null);
      setSetupToken(null);
    },
  });

  const startEmailMutation = useMutation({
    mutationFn: startEmail2FA,
    onSuccess: () => {
      setEmailStep('sent');
      setCode('');
    },
  });

  const confirmEmailMutation = useMutation({
    mutationFn: () => confirmEmail2FA(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setEmailStep('idle');
      setCode('');
    },
  });

  const disableMutation = useMutation({
    mutationFn: () =>
      hasPassword
        ? disable2FA({ password })
        : disable2FA({ code: code.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setDisableStep('idle');
      setPassword('');
      setCode('');
      setEmailStep('idle');
    },
  });

  const has2FA = twoFactor?.methods != null && twoFactor.methods !== '';
  const twoFactorEnforced = setup?.twoFactorEnforced ?? false;
  const canDisable = !twoFactorEnforced;

  const errorMsg =
    startTotpMutation.error?.message ??
    confirmTotpMutation.error?.message ??
    startEmailMutation.error?.message ??
    confirmEmailMutation.error?.message ??
    disableMutation.error?.message ??
    null;

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Two-Factor Authentication</h2>
      <p className={styles.cardSub}>
        Add an extra layer of security using an authenticator app, email codes, or other methods enabled by your administrator.
      </p>

      {errorMsg && (
        <p id="twofactor-profile-error" className={styles.error} style={{ marginBottom: 12 }} role="alert">
          {errorMsg}
        </p>
      )}

      {has2FA ? (
        <div>
          <p className={styles.cardNote} style={{ marginBottom: 12 }}>
            {twoFactor?.hasTOTP && 'Authenticator app (TOTP) enabled. '}
            {twoFactor?.hasEmail && 'Email codes enabled.'}
          </p>
          {canDisable && (
            <>
              {disableStep === 'idle' ? (
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => {
                    if (hasPassword) {
                      setDisableStep('password');
                    } else if (twoFactor?.hasEmail && !twoFactor?.hasTOTP) {
                      setDisableStep('send-email');
                    } else {
                      setDisableStep('code');
                    }
                  }}
                >
                  <ShieldOff size={18} strokeWidth={2} aria-hidden />
                  Disable 2FA
                </button>
              ) : disableStep === 'send-email' ? (
                <>
                  <div className={styles.federatedCard} style={{ marginBottom: 12 }}>
                    <p className={styles.federatedCardText}>
                      A code will be sent to your email. Enter it below to disable 2FA.
                    </p>
                  </div>
                  <div className={styles.twoFactorBtnRow}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => {
                        setDisableStep('idle');
                        setEmailStep('idle');
                        disableMutation.reset();
                        startEmailMutation.reset();
                      }}
                    >
                      <X size={18} strokeWidth={2} aria-hidden />
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => {
                        startEmailMutation.mutate(undefined, {
                          onSuccess: () => setDisableStep('code'),
                        });
                      }}
                      disabled={startEmailMutation.isPending}
                    >
                      <Mail size={18} strokeWidth={2} aria-hidden />
                      {startEmailMutation.isPending ? 'Sending...' : 'Send code to email'}
                    </button>
                  </div>
                </>
              ) : disableStep === 'password' ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password.trim()) disableMutation.mutate();
                  }}
                >
                  <label className={styles.label}>
                    Enter your password to disable 2FA
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={styles.input}
                      placeholder="Password"
                      autoComplete="current-password"
                    />
                  </label>
                  <div className={styles.twoFactorBtnRow}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => {
                        setDisableStep('idle');
                        setPassword('');
                        disableMutation.reset();
                      }}
                    >
                      <X size={18} strokeWidth={2} aria-hidden />
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.dangerBtn}
                      disabled={!password.trim() || disableMutation.isPending}
                    >
                      <ShieldOff size={18} strokeWidth={2} aria-hidden />
                      {disableMutation.isPending ? 'Disabling...' : 'Confirm disable'}
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.length >= 6) disableMutation.mutate();
                  }}
                >
                  <p className={styles.cardNote} style={{ marginBottom: 12 }}>
                    {twoFactor?.hasTOTP
                      ? 'Enter the 6-digit code from your authenticator app.'
                      : 'Enter the 6-digit code sent to your email.'}
                  </p>
                  <OtpInput
                    value={code}
                    onChange={setCode}
                    length={6}
                    disabled={disableMutation.isPending}
                    label="Code"
                    error={!!disableMutation.isError}
                    ariaLabel="6-digit verification code"
                    ariaDescribedBy={disableMutation.isError ? 'twofactor-profile-error' : undefined}
                  />
                  <div className={styles.twoFactorBtnRow}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => {
                        setDisableStep('idle');
                        setCode('');
                        setEmailStep('idle');
                        disableMutation.reset();
                      }}
                    >
                      <X size={18} strokeWidth={2} aria-hidden />
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.dangerBtn}
                      disabled={code.length < 6 || disableMutation.isPending}
                    >
                      <ShieldOff size={18} strokeWidth={2} aria-hidden />
                      {disableMutation.isPending ? 'Disabling...' : 'Confirm disable'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
          {!canDisable && (
            <p className={styles.cardNote}>2FA is enforced by the administrator and cannot be disabled.</p>
          )}
        </div>
      ) : (
        <div>
          {totpStep === 'idle' && emailStep === 'idle' && (
            <>
              {totp2FAAvailable && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => setTotpStep('password')}
                  style={{ marginRight: 8, marginBottom: 8 }}
                >
                  <Shield size={18} strokeWidth={2} aria-hidden />
                  Add authenticator app (TOTP)
                </button>
              )}
              {email2FAAvailable && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => startEmailMutation.mutate()}
                  disabled={startEmailMutation.isPending}
                >
                  <Mail size={18} strokeWidth={2} aria-hidden />
                  {startEmailMutation.isPending ? 'Sending...' : 'Add email 2FA'}
                </button>
              )}
              {twoFactorEnabled && availableMethods.length === 0 && (
                <p className={styles.cardNote}>
                  No 2FA methods are currently available. Enable methods in Settings and configure any required providers (e.g. email).
                </p>
              )}
              {!twoFactorEnabled && (
                <p className={styles.cardNote}>
                  Two-factor authentication is not enabled by your administrator.
                </p>
              )}
            </>
          )}

          {totpStep === 'password' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (password.trim()) startTotpMutation.mutate();
              }}
            >
              <label className={styles.label}>
                Enter your password to add TOTP
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </label>
              <div className={styles.twoFactorBtnRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setTotpStep('idle');
                    setPassword('');
                    startTotpMutation.reset();
                  }}
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={!password.trim() || startTotpMutation.isPending}
                >
                  {startTotpMutation.isPending ? 'Generating...' : (
                    <>
                      Continue
                      <ChevronRight size={18} strokeWidth={2} aria-hidden />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {totpStep === 'confirm' && qrDataUrl && secret && (
            <div>
              <p className={styles.cardNote} style={{ marginBottom: 12 }}>
                Scan with Authy, Microsoft Authenticator, 1Password, or similar. Then enter the 6-digit code.
              </p>
              <img src={qrDataUrl} alt="QR code" width={160} height={160} style={{ marginBottom: 12 }} />
              <OtpInput
                value={code}
                onChange={setCode}
                length={6}
                disabled={confirmTotpMutation.isPending}
                label="Code"
                error={!!confirmTotpMutation.isError}
                ariaLabel="6-digit verification code"
                ariaDescribedBy={confirmTotpMutation.isError ? 'twofactor-profile-error' : undefined}
              />
              <div className={styles.twoFactorBtnRow}>
                <span />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => confirmTotpMutation.mutate()}
                  disabled={code.length < 6 || confirmTotpMutation.isPending}
                >
                  {confirmTotpMutation.isPending ? 'Verifying...' : (
                    <>
                      <Check size={18} strokeWidth={2} aria-hidden />
                      Verify
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {emailStep === 'sent' && (
            <div>
              <p className={styles.cardNote} style={{ marginBottom: 12 }}>
                Check your email for the 6-digit code.
              </p>
              <OtpInput
                value={code}
                onChange={setCode}
                length={6}
                disabled={confirmEmailMutation.isPending}
                label="Code"
                error={!!confirmEmailMutation.isError}
                ariaLabel="6-digit verification code"
                ariaDescribedBy={confirmEmailMutation.isError ? 'twofactor-profile-error' : undefined}
              />
              <div className={styles.twoFactorBtnRow}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setEmailStep('idle');
                    startEmailMutation.reset();
                    confirmEmailMutation.reset();
                  }}
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => confirmEmailMutation.mutate()}
                  disabled={code.length < 6 || confirmEmailMutation.isPending}
                >
                  {confirmEmailMutation.isPending ? 'Verifying...' : (
                    <>
                      <Check size={18} strokeWidth={2} aria-hidden />
                      Verify
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
