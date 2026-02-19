import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, getCommands } from '../api/settings';
import { getVersion } from '../api/version';
import { FullPageLoading } from '../components/Loading';
import { useSettingsForm } from '../hooks/useSettingsForm';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useFormDirtyTracking } from '../hooks/useFormDirtyTracking';
import { OLLAMA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL } from '../hooks/useSettingsForm';
import {
  AccessGeneralSection,
  DefaultLimitsSection,
  FinalOutputSection,
  GeoliteSection,
  WhisperSection,
  LLMSection,
  CaptchaSection,
  WebRTCSection,
  EmailSection,
  TwoFactorSection,
  SsoSection,
  DnsConfigurationSection,
  CustomLegalSection,
} from '../components/Settings';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import styles from './Settings.module.css';

export function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isFetching, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(),
  });

  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: getVersion,
    staleTime: 5 * 60 * 1000,
  });

  const { data: commandsData } = useQuery({
    queryKey: ['settings', 'commands'],
    queryFn: () => getCommands().then((r) => r.commands),
    staleTime: 2 * 60 * 1000,
  });

  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const saveFromFloatingBarRef = useRef(false);
  const lastSavedRef = useRef<string | null>(null);
  const welcomeBannerRef = useRef<HTMLTextAreaElement>(null);

  // Use custom hooks
  const { form, updateForm, setForm } = useSettingsForm(settings);

  const {
    testMutation,
    whisperTestMutation,
    transcriptionOpenaiTestMutation,
    smtpTestMutation,
    sendgridTestMutation,
    geoliteTestMutation,
    geoliteCheckMutation,
    geoliteUpdateMutation,
  } = useSettingsMutations({ form });

  // Track last saved state
  useEffect(() => {
    if (settings) {
      lastSavedRef.current = JSON.stringify(settings);
    }
  }, [settings]);

  // Auto-resize welcome banner
  const resizeWelcomeBanner = useCallback(() => {
    const el = welcomeBannerRef.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, 60);
    el.style.height = `${h}px`;
  }, []);

  useEffect(() => {
    resizeWelcomeBanner();
  }, [form.welcomeBanner, resizeWelcomeBanner]);

  // Main save mutation
  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        whisperAsrUrl: form.whisperAsrUrl.trim().replace(/\/+$/, ''),
        transcriptionProvider: form.transcriptionProvider,
        openaiTranscriptionUrl: form.openaiTranscriptionUrl?.trim() || undefined,
        openaiTranscriptionApiKey: form.openaiTranscriptionApiKey === '(set)' ? undefined : form.openaiTranscriptionApiKey,
        transcriptionModel: form.transcriptionModel?.trim() || undefined,
        defaultCanTranscribe: form.defaultCanTranscribe,
        llmProvider: form.llmProvider,
        ollamaUrl: form.ollamaUrl,
        openaiApiKey: form.openaiApiKey === '(set)' ? undefined : form.openaiApiKey,
        model: form.model,
        registrationEnabled: form.registrationEnabled,
        publicFeedsEnabled: form.publicFeedsEnabled,
        gdprConsentBannerEnabled: form.gdprConsentBannerEnabled,
        websubDiscoveryEnabled: form.websubDiscoveryEnabled,
        hostname: form.hostname,
        websubHub: form.websubHub,
        finalBitrateKbps: form.finalBitrateKbps,
        finalChannels: form.finalChannels,
        finalFormat: form.finalFormat,
        maxmindAccountId: form.maxmindAccountId.trim(),
        maxmindLicenseKey: form.maxmindLicenseKey === '(set)' ? undefined : form.maxmindLicenseKey,
        defaultMaxPodcasts: form.defaultMaxPodcasts,
        defaultStorageMb: form.defaultStorageMb,
        defaultMaxEpisodes: form.defaultMaxEpisodes,
        defaultMaxCollaborators: form.defaultMaxCollaborators,
        defaultMaxSubscriberTokens: form.defaultMaxSubscriberTokens,
        captchaProvider: form.captchaProvider,
        captchaSiteKey: form.captchaProvider === 'none' ? '' : form.captchaSiteKey.trim(),
        captchaSecretKey:
          form.captchaProvider === 'none' ? '' : form.captchaSecretKey === '(set)' ? undefined : form.captchaSecretKey,
        emailProvider: form.emailProvider,
        emailWebhookUrl: form.emailProvider === 'webhook' ? form.emailWebhookUrl.trim() : '',
        emailWebhookFieldKey: form.emailProvider === 'webhook' ? (form.emailWebhookFieldKey.trim() || 'content') : 'content',
        smtpHost: form.emailProvider === 'smtp' ? form.smtpHost.trim() : '',
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.emailProvider === 'smtp' ? form.smtpUser.trim() : '',
        smtpPassword: form.emailProvider === 'smtp' && form.smtpPassword !== '(set)' ? form.smtpPassword : undefined,
        smtpFrom: form.emailProvider === 'smtp' ? form.smtpFrom.trim() : '',
        sendgridApiKey: form.emailProvider === 'sendgrid' && form.sendgridApiKey !== '(set)' ? form.sendgridApiKey : undefined,
        sendgridFrom: form.emailProvider === 'sendgrid' ? form.sendgridFrom.trim() : '',
        emailEnableRegistrationVerification: form.emailEnableRegistrationVerification,
        emailEnableWelcomeAfterVerify: form.emailEnableWelcomeAfterVerify,
        emailEnablePasswordReset: form.emailEnablePasswordReset,
        emailEnableAdminWelcome: form.emailEnableAdminWelcome,
        emailEnableNewShow: form.emailEnableNewShow,
        emailEnableInvite: form.emailEnableInvite,
        emailEnableContact: form.emailEnableContact,
        welcomeBanner: form.welcomeBanner,
        customTerms: form.customTerms,
        customPrivacy: form.customPrivacy,
        dnsProvider: form.dnsProvider,
        dnsProviderApiToken:
          (form.dnsProviderApiToken && form.dnsProviderApiToken !== '(set)')
            ? form.dnsProviderApiToken
            : form.dnsProviderApiTokenSet
              ? '(set)'
              : undefined,
        dnsUseCname: form.dnsUseCname,
        dnsARecordIp: form.dnsARecordIp,
        dnsAllowLinkingDomain: form.dnsAllowLinkingDomain,
        dnsDefaultAllowDomain: form.dnsDefaultAllowDomain,
        dnsDefaultAllowDomains: (() => {
          const v = form.dnsDefaultAllowDomains;
          if (typeof v === 'string') {
            if (v.trim().startsWith('[')) {
              try {
                const arr = JSON.parse(v) as unknown;
                const list = Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
                return JSON.stringify(list);
              } catch {
                const list = v.split(',').map((s) => s.trim()).filter(Boolean);
                return JSON.stringify(list);
              }
            }
            return v;
          }
          return '[]';
        })(),
        dnsDefaultAllowCustomKey: form.dnsDefaultAllowCustomKey,
        dnsDefaultAllowSubDomain: form.dnsDefaultAllowSubDomain,
        dnsDefaultDomain: form.dnsDefaultDomain,
        dnsDefaultEnableCloudflareProxy: form.dnsDefaultEnableCloudflareProxy,
        webrtcServiceUrl: form.webrtcServiceUrl?.trim() ?? '',
        webrtcPublicWsUrl: form.webrtcPublicWsUrl?.trim() ?? '',
        recordingCallbackSecret:
          form.recordingCallbackSecret === '(set)' ? undefined : form.recordingCallbackSecret,
        twoFactorEnabled: form.twoFactorEnabled,
        twoFactorMethods: form.twoFactorMethods,
        twoFactorEnforced: form.twoFactorEnforced,
        ssoOidcProviders: form.ssoOidcProviders,
        ssoSamlProviders: form.ssoSamlProviders,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setForm(data);
      lastSavedRef.current = JSON.stringify(data);
      setSaveNotice({ type: 'success', message: 'Settings saved.' });
      if (!saveFromFloatingBarRef.current) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      saveFromFloatingBarRef.current = false;
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to save settings.';
      setSaveNotice({ type: 'error', message: msg });
    },
  });

  // Track dirty state
  const isDirty = useFormDirtyTracking(form, lastSavedRef.current);

  // Form submission handlers
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveNotice(null);
    saveFromFloatingBarRef.current = false;
    mutation.mutate();
  }

  function handleFloatingSave() {
    setSaveNotice(null);
    saveFromFloatingBarRef.current = true;
    mutation.mutate();
  }

  // Handle LLM provider change
  const handleLLMProviderChange = useCallback(
    (provider: typeof form.llmProvider) => {
      updateForm({
        llmProvider: provider,
        model:
          provider === 'openai'
            ? OPENAI_DEFAULT_MODEL
            : provider === 'ollama'
              ? OLLAMA_DEFAULT_MODEL
              : form.model,
      });
    },
    [updateForm, form]
  );

  if (isLoading || (!settings && isFetching)) return <FullPageLoading />;
  if (isError) {
    return (
      <div className={styles.page}>
        <header className={styles.hero}>
          <h1 className={styles.heroTitle}>Settings</h1>
          <p className={styles.heroSub}>Control your server configuration and access settings.</p>
        </header>
        <FailedToLoadCard title="Failed to load settings" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Settings</h1>
        <p className={styles.heroSub}>Control your server configuration and access settings.</p>
      </header>

      {saveNotice?.type === 'success' && (
        <div className={`${styles.noticeSuccess} ${styles.saveNoticeCard}`} role="status" aria-live="polite">
          <span className={styles.noticeTitle}>Success</span>
          <p className={styles.noticeBody}>{saveNotice.message}</p>
        </div>
      )}
      {saveNotice?.type === 'error' && (
        <div className={`${styles.noticeError} ${styles.saveNoticeCard}`} role="alert" aria-live="polite">
          <span className={styles.noticeTitle}>Error</span>
          <p className={styles.noticeBody}>{saveNotice.message}</p>
        </div>
      )}

      {(versionData?.version != null || commandsData != null) && (
        <div className={styles.versionCard}>
          <div className={styles.versionCommands}>
            {commandsData != null &&
              Object.entries(commandsData)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name]) => (
                  <span key={name} className={styles.commandBadge} title={commandsData[name] ? 'Present' : 'Not found'}>
                    <span
                      className={styles.commandDot}
                      style={{ background: commandsData[name] ? 'var(--accent)' : 'var(--error)' }}
                      aria-hidden
                    />
                    <code className={styles.commandName}>{name}</code>
                  </span>
              ))}
          </div>
          {versionData?.version && (
            <div className={styles.versionBlock}>
              <span className={styles.versionLabel}>Version</span>
              <span className={styles.versionValue}>{versionData.version}</span>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <AccessGeneralSection
          form={form}
          onFormChange={updateForm}
          welcomeBannerRef={welcomeBannerRef}
          onResizeWelcomeBanner={resizeWelcomeBanner}
        />

        <DefaultLimitsSection form={form} onFormChange={updateForm} />

        <FinalOutputSection form={form} onFormChange={updateForm} />

        <GeoliteSection
          form={form}
          onFormChange={updateForm}
          geoliteTestMutation={geoliteTestMutation}
          geoliteCheckMutation={geoliteCheckMutation}
          geoliteUpdateMutation={geoliteUpdateMutation}
          onGeoliteTest={() =>
            geoliteTestMutation.mutate({
              maxmindAccountId: form.maxmindAccountId.trim(),
              maxmindLicenseKey:
                form.maxmindLicenseKey === '(set)' ? undefined : form.maxmindLicenseKey.trim() || undefined,
            })
          }
          onGeoliteCheck={() => geoliteCheckMutation.mutate()}
          onGeoliteUpdate={() =>
            geoliteUpdateMutation.mutate({
              maxmindAccountId: form.maxmindAccountId.trim(),
              maxmindLicenseKey:
                form.maxmindLicenseKey === '(set)' ? undefined : form.maxmindLicenseKey.trim() || undefined,
            })
          }
        />

        <WhisperSection
          form={form}
          onFormChange={updateForm}
          whisperTestMutation={whisperTestMutation}
          onWhisperTest={() => whisperTestMutation.mutate()}
          transcriptionOpenaiTestMutation={transcriptionOpenaiTestMutation}
          onTranscriptionOpenaiTest={() => transcriptionOpenaiTestMutation.mutate()}
        />

        <LLMSection
          form={form}
          onFormChange={updateForm}
          testMutation={testMutation}
          onTest={() => testMutation.mutate()}
          onProviderChange={handleLLMProviderChange}
        />

        <CaptchaSection form={form} onFormChange={updateForm} />

        <WebRTCSection form={form} onFormChange={updateForm} />

        <EmailSection
          form={form}
          onFormChange={updateForm}
          smtpTestMutation={smtpTestMutation}
          sendgridTestMutation={sendgridTestMutation}
          onSmtpTest={() => smtpTestMutation.mutate()}
          onSendGridTest={() => sendgridTestMutation.mutate()}
        />

        <TwoFactorSection form={form} onFormChange={updateForm} />

        <SsoSection form={form} onFormChange={updateForm} />

        <DnsConfigurationSection form={form} onFormChange={updateForm} />

        <CustomLegalSection form={form} onFormChange={updateForm} />

        <div className={styles.actions}>
          <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Save settings">
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>

      <div
        className={styles.floatingSaveWrap}
        data-visible={isDirty}
        role="region"
        aria-label="Save settings"
        aria-hidden={!isDirty}
      >
        <div className={styles.floatingSaveBar}>
          <span className={styles.floatingSaveLabel}>Unsaved changes</span>
          <button
            type="button"
            className={styles.floatingSaveBtn}
            onClick={handleFloatingSave}
            disabled={mutation.isPending}
            aria-label="Save settings"
            tabIndex={isDirty ? undefined : -1}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
