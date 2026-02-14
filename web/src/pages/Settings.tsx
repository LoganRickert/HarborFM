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
  }, [form.welcome_banner, resizeWelcomeBanner]);

  // Main save mutation
  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        whisper_asr_url: form.whisper_asr_url.trim().replace(/\/+$/, ''),
        transcription_provider: form.transcription_provider,
        openai_transcription_url: form.openai_transcription_url?.trim() || undefined,
        openai_transcription_api_key: form.openai_transcription_api_key === '(set)' ? undefined : form.openai_transcription_api_key,
        transcription_model: form.transcription_model?.trim() || undefined,
        default_can_transcribe: form.default_can_transcribe,
        llm_provider: form.llm_provider,
        ollama_url: form.ollama_url,
        openai_api_key: form.openai_api_key === '(set)' ? undefined : form.openai_api_key,
        model: form.model,
        registration_enabled: form.registration_enabled,
        public_feeds_enabled: form.public_feeds_enabled,
        gdpr_consent_banner_enabled: form.gdpr_consent_banner_enabled,
        websub_discovery_enabled: form.websub_discovery_enabled,
        hostname: form.hostname,
        websub_hub: form.websub_hub,
        final_bitrate_kbps: form.final_bitrate_kbps,
        final_channels: form.final_channels,
        final_format: form.final_format,
        maxmind_account_id: form.maxmind_account_id.trim(),
        maxmind_license_key: form.maxmind_license_key === '(set)' ? undefined : form.maxmind_license_key,
        default_max_podcasts: form.default_max_podcasts,
        default_storage_mb: form.default_storage_mb,
        default_max_episodes: form.default_max_episodes,
        default_max_collaborators: form.default_max_collaborators,
        default_max_subscriber_tokens: form.default_max_subscriber_tokens,
        captcha_provider: form.captcha_provider,
        captcha_site_key: form.captcha_provider === 'none' ? '' : form.captcha_site_key.trim(),
        captcha_secret_key:
          form.captcha_provider === 'none' ? '' : form.captcha_secret_key === '(set)' ? undefined : form.captcha_secret_key,
        email_provider: form.email_provider,
        smtp_host: form.email_provider === 'smtp' ? form.smtp_host.trim() : '',
        smtp_port: form.smtp_port,
        smtp_secure: form.smtp_secure,
        smtp_user: form.email_provider === 'smtp' ? form.smtp_user.trim() : '',
        smtp_password: form.email_provider === 'smtp' && form.smtp_password !== '(set)' ? form.smtp_password : undefined,
        smtp_from: form.email_provider === 'smtp' ? form.smtp_from.trim() : '',
        sendgrid_api_key: form.email_provider === 'sendgrid' && form.sendgrid_api_key !== '(set)' ? form.sendgrid_api_key : undefined,
        sendgrid_from: form.email_provider === 'sendgrid' ? form.sendgrid_from.trim() : '',
        email_enable_registration_verification: form.email_enable_registration_verification,
        email_enable_welcome_after_verify: form.email_enable_welcome_after_verify,
        email_enable_password_reset: form.email_enable_password_reset,
        email_enable_admin_welcome: form.email_enable_admin_welcome,
        email_enable_new_show: form.email_enable_new_show,
        email_enable_invite: form.email_enable_invite,
        email_enable_contact: form.email_enable_contact,
        welcome_banner: form.welcome_banner,
        custom_terms: form.custom_terms,
        custom_privacy: form.custom_privacy,
        dns_provider: form.dns_provider,
        dns_provider_api_token:
          (form.dns_provider_api_token && form.dns_provider_api_token !== '(set)')
            ? form.dns_provider_api_token
            : form.dns_provider_api_token_set
              ? '(set)'
              : undefined,
        dns_use_cname: form.dns_use_cname,
        dns_a_record_ip: form.dns_a_record_ip,
        dns_allow_linking_domain: form.dns_allow_linking_domain,
        dns_default_allow_domain: form.dns_default_allow_domain,
        dns_default_allow_domains: (() => {
          const v = form.dns_default_allow_domains;
          if (typeof v === 'string') {
            if (v.trim().startsWith('[')) {
              try {
                const arr = JSON.parse(v) as unknown;
                return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
              } catch {
                return v.split(',').map((s) => s.trim()).filter(Boolean);
              }
            }
            return v.split(',').map((s) => s.trim()).filter(Boolean);
          }
          return [];
        })(),
        dns_default_allow_custom_key: form.dns_default_allow_custom_key,
        dns_default_allow_sub_domain: form.dns_default_allow_sub_domain,
        dns_default_domain: form.dns_default_domain,
        dns_default_enable_cloudflare_proxy: form.dns_default_enable_cloudflare_proxy,
        webrtc_service_url: form.webrtc_service_url?.trim() ?? '',
        webrtc_public_ws_url: form.webrtc_public_ws_url?.trim() ?? '',
        recording_callback_secret:
          form.recording_callback_secret === '(set)' ? undefined : form.recording_callback_secret,
      } as unknown as Parameters<typeof updateSettings>[0]),
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
    (provider: typeof form.llm_provider) => {
      updateForm({
        llm_provider: provider,
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
              maxmind_account_id: form.maxmind_account_id.trim(),
              maxmind_license_key:
                form.maxmind_license_key === '(set)' ? undefined : form.maxmind_license_key.trim() || undefined,
            })
          }
          onGeoliteCheck={() => geoliteCheckMutation.mutate()}
          onGeoliteUpdate={() =>
            geoliteUpdateMutation.mutate({
              maxmind_account_id: form.maxmind_account_id.trim(),
              maxmind_license_key:
                form.maxmind_license_key === '(set)' ? undefined : form.maxmind_license_key.trim() || undefined,
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
