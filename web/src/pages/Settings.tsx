import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, getCommands, getSystemStats } from '../api/settings';
import { getVersion } from '../api/version';
import { FullPageLoading } from '../components/Loading';
import { useSettingsForm } from '../hooks/useSettingsForm';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useFormDirtyTracking } from '../hooks/useFormDirtyTracking';
import { OLLAMA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL } from '../hooks/useSettingsForm';
import {
  SystemSection,
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
  ReviewSettingsSection,
} from '../components/Settings';
import { FailedToLoadCard } from '../components/FailedToLoadCard';
import {
  SETTINGS_TABS,
  filterTabsBySearch,
  normalizeSearchQuery,
  type SettingsTabId,
} from './Settings/tabs';
import { Search, X, Menu } from 'lucide-react';
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

  const { data: systemStatsData } = useQuery({
    queryKey: ['settings', 'system-stats'],
    queryFn: getSystemStats,
    staleTime: 30 * 1000,
  });

  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [activeTabId, setActiveTabId] = useState<SettingsTabId>('system');
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const saveFromFloatingBarRef = useRef(false);
  const lastSavedRef = useRef<string | null>(null);
  const welcomeBannerRef = useRef<HTMLTextAreaElement>(null);
  const tabPanelRef = useRef<HTMLDivElement>(null);

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

  // Filter tabs by search; when current tab not in list, switch to first match
  const matchingTabIds = filterTabsBySearch(SETTINGS_TABS, searchQuery);
  const visibleTabs = searchQuery.trim()
    ? SETTINGS_TABS.filter((t) => matchingTabIds.includes(t.id))
    : SETTINGS_TABS;

  useEffect(() => {
    if (searchQuery.trim() && !matchingTabIds.includes(activeTabId) && matchingTabIds.length > 0) {
      setActiveTabId(matchingTabIds[0]);
    }
  }, [searchQuery, matchingTabIds, activeTabId]);

  // Scroll to first matching control when tab is shown with a search query
  useEffect(() => {
    if (!searchQuery.trim() || !tabPanelRef.current) return;
    const normalized = normalizeSearchQuery(searchQuery);
    const candidates = tabPanelRef.current.querySelectorAll<HTMLElement>('[data-settings-label]');
    for (const el of candidates) {
      const label = el.getAttribute('data-settings-label');
      if (label && label.toLowerCase().includes(normalized)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add(styles.highlightControl);
        const t = setTimeout(() => el.classList.remove(styles.highlightControl), 2000);
        return () => clearTimeout(t);
      }
    }
  }, [activeTabId, searchQuery]);

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
        defaultCanGenerateVideo: form.defaultCanGenerateVideo,
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
        loudnessTargetLufs: form.loudnessTargetLufs,
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
        emailEnableReviewVerification: form.emailEnableReviewVerification,
        reviewsEnabled: form.reviewsEnabled,
        reviewsPublishNonVerified: form.reviewsPublishNonVerified,
        reviewsLlmSpamCheck: form.reviewsLlmSpamCheck,
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
                return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
              } catch {
                return v.split(',').map((s) => s.trim()).filter(Boolean);
              }
            }
            return v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
          }
          return Array.isArray(v) ? v : [];
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
        emailSigninDisabled: form.emailSigninDisabled,
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

  function selectTab(id: SettingsTabId) {
    setActiveTabId(id);
    setDrawerOpen(false);
  }

  function handleTabListKeyDown(e: React.KeyboardEvent) {
    const list = visibleTabs;
    const currentIndex = list.findIndex((t) => t.id === activeTabId);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      nextIndex = Math.min(currentIndex + 1, list.length - 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = list.length - 1;
    } else return;
    if (nextIndex !== currentIndex) setActiveTabId(list[nextIndex].id);
  }

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

  const activeTabLabel = SETTINGS_TABS.find((t) => t.id === activeTabId)?.label ?? 'Settings';

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

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.searchWrap}>
          <div className={styles.searchInputWrap}>
            <Search className={styles.searchIcon} size={18} aria-hidden />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search settings…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search settings"
              autoComplete="off"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className={styles.tabDrawerTrigger}
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          aria-label="Open sections menu"
          aria-controls="settings-tab-drawer"
        >
          <span>{activeTabLabel}</span>
          <Menu className={styles.tabDrawerTriggerIcon} size={20} aria-hidden />
        </button>

        <div className={styles.settingsLayout}>
          <nav className={styles.tabListWrap} aria-label="Settings sections">
            <ul
              className={styles.tabList}
              role="tablist"
              aria-label="Settings sections"
              onKeyDown={handleTabListKeyDown}
            >
              {visibleTabs.length === 0 ? (
                <li className={styles.tabListEmpty} role="status">
                  No sections match your search.
                </li>
              ) : (
                visibleTabs.map((tab) => (
                  <li key={tab.id} role="presentation">
                    <button
                      type="button"
                      role="tab"
                      id={`settings-tab-${tab.id}`}
                      aria-selected={activeTabId === tab.id}
                      aria-controls={`settings-panel-${tab.id}`}
                      tabIndex={activeTabId === tab.id ? 0 : -1}
                      className={styles.tab}
                      onClick={() => selectTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </nav>

          <div
            ref={tabPanelRef}
            className={styles.tabPanel}
            role="tabpanel"
            id={`settings-panel-${activeTabId}`}
            aria-labelledby={`settings-tab-${activeTabId}`}
          >
            {activeTabId === 'system' && (
              <SystemSection
                version={versionData?.version ?? null}
                commands={commandsData ?? null}
                systemStats={systemStatsData ?? null}
              />
            )}
            {activeTabId === 'access' && (
              <AccessGeneralSection
                form={form}
                onFormChange={updateForm}
                welcomeBannerRef={welcomeBannerRef}
                onResizeWelcomeBanner={resizeWelcomeBanner}
              />
            )}
            {activeTabId === 'default-limits' && (
              <DefaultLimitsSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'final-output' && (
              <FinalOutputSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'geolite' && (
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
            )}
            {activeTabId === 'transcription' && (
              <WhisperSection
                form={form}
                onFormChange={updateForm}
                whisperTestMutation={whisperTestMutation}
                onWhisperTest={() => whisperTestMutation.mutate()}
                transcriptionOpenaiTestMutation={transcriptionOpenaiTestMutation}
                onTranscriptionOpenaiTest={() => transcriptionOpenaiTestMutation.mutate()}
              />
            )}
            {activeTabId === 'llm' && (
              <LLMSection
                form={form}
                onFormChange={updateForm}
                testMutation={testMutation}
                onTest={() => testMutation.mutate()}
                onProviderChange={handleLLMProviderChange}
              />
            )}
            {activeTabId === 'captcha' && (
              <CaptchaSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'webrtc' && (
              <WebRTCSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'email' && (
              <EmailSection
                form={form}
                onFormChange={updateForm}
                smtpTestMutation={smtpTestMutation}
                sendgridTestMutation={sendgridTestMutation}
                onSmtpTest={() => smtpTestMutation.mutate()}
                onSendGridTest={() => sendgridTestMutation.mutate()}
              />
            )}
            {activeTabId === 'two-factor' && (
              <TwoFactorSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'sso' && (
              <SsoSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'dns' && (
              <DnsConfigurationSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'custom-legal' && (
              <CustomLegalSection form={form} onFormChange={updateForm} />
            )}
            {activeTabId === 'reviews' && (
              <ReviewSettingsSection form={form} onFormChange={updateForm} />
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Save settings">
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Mobile drawer for tab list */}
      {drawerOpen && (
        <>
          <div
            className={styles.tabDrawerOverlay}
            role="presentation"
            aria-hidden
            onClick={() => setDrawerOpen(false)}
          />
          <div
            id="settings-tab-drawer"
            className={styles.tabDrawerContent}
            role="dialog"
            aria-modal="true"
            aria-label="Settings sections"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDrawerOpen(false);
              else handleTabListKeyDown(e as React.KeyboardEvent<HTMLDivElement>);
            }}
          >
            <h2 className={styles.tabDrawerTitle}>Sections</h2>
            <ul className={styles.tabDrawerList} role="tablist">
              {visibleTabs.length === 0 ? (
                <li className={styles.tabListEmpty} role="status">
                  No sections match your search.
                </li>
              ) : (
                visibleTabs.map((tab) => (
                  <li key={tab.id} className={styles.tabDrawerItem} role="presentation">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTabId === tab.id}
                      className={styles.tab}
                      onClick={() => selectTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}

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
