import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, testLlmConnection, testWhisperConnection, testSmtpConnection, testSendGridConnection, type AppSettings } from '../api/settings';
import { FullPageLoading } from '../components/Loading';
import styles from './Settings.module.css';

const OLLAMA_DEFAULT_MODEL = 'llama3.2:latest';
const OPENAI_DEFAULT_MODEL = 'gpt-5-mini';

const LLM_OPTIONS: { value: AppSettings['llm_provider']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
];

const CAPTCHA_OPTIONS: { value: AppSettings['captcha_provider']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'hcaptcha', label: 'hCaptcha' },
  { value: 'recaptcha_v2', label: 'Google v2' },
  { value: 'recaptcha_v3', label: 'Google v3' },
];

const EMAIL_OPTIONS: { value: AppSettings['email_provider']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'smtp', label: 'SMTP' },
  { value: 'sendgrid', label: 'SendGrid' },
];

export function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isFetching, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(),
  });

  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [form, setForm] = useState<AppSettings>({
    whisper_asr_url: '',
    llm_provider: 'none',
    ollama_url: 'http://localhost:11434',
    openai_api_key: '',
    model: OLLAMA_DEFAULT_MODEL,
    registration_enabled: true,
    public_feeds_enabled: true,
    hostname: '',
    final_bitrate_kbps: 128,
    final_channels: 'mono',
    final_format: 'mp3',
    maxmind_account_id: '',
    maxmind_license_key: '',
    default_max_podcasts: null,
    default_storage_mb: null,
    default_max_episodes: null,
    captcha_provider: 'none',
    captcha_site_key: '',
    captcha_secret_key: '',
    email_provider: 'none',
    smtp_host: '',
    smtp_port: 587,
    smtp_secure: true,
    smtp_user: '',
    smtp_password: '',
    smtp_from: '',
    sendgrid_api_key: '',
    sendgrid_from: '',
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        whisper_asr_url: form.whisper_asr_url.trim().replace(/\/+$/, ''),
        llm_provider: form.llm_provider,
        ollama_url: form.ollama_url,
        openai_api_key: form.openai_api_key === '(set)' ? undefined : form.openai_api_key,
        model: form.model,
        registration_enabled: form.registration_enabled,
        public_feeds_enabled: form.public_feeds_enabled,
        hostname: form.hostname,
        final_bitrate_kbps: form.final_bitrate_kbps,
        final_channels: form.final_channels,
        final_format: form.final_format,
        maxmind_account_id: form.maxmind_account_id.trim(),
        maxmind_license_key: form.maxmind_license_key === '(set)' ? undefined : form.maxmind_license_key,
        default_max_podcasts: form.default_max_podcasts,
        default_storage_mb: form.default_storage_mb,
        default_max_episodes: form.default_max_episodes,
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
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setForm(data);
      setSaveNotice({ type: 'success', message: 'Settings saved.' });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to save settings.';
      setSaveNotice({ type: 'error', message: msg });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof testLlmConnection>[0] = {
        llm_provider: form.llm_provider as 'ollama' | 'openai',
      };
      if (form.llm_provider === 'ollama') payload.ollama_url = form.ollama_url;
      if (form.llm_provider === 'openai') {
        payload.openai_api_key = form.openai_api_key === '(set)' ? undefined : form.openai_api_key;
      }
      return testLlmConnection(payload);
    },
  });

  useEffect(() => {
    testMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear when provider changes
  }, [form.llm_provider]);

  const whisperTestMutation = useMutation({
    mutationFn: () => testWhisperConnection(form.whisper_asr_url),
  });

  useEffect(() => {
    whisperTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear when URL changes
  }, [form.whisper_asr_url]);

  const smtpTestMutation = useMutation({
    mutationFn: () =>
      testSmtpConnection({
        smtp_host: form.smtp_host.trim(),
        smtp_port: form.smtp_port,
        smtp_secure: form.smtp_secure,
        smtp_user: form.smtp_user.trim(),
        smtp_password: form.smtp_password === '(set)' ? '' : form.smtp_password,
      }),
  });

  const sendgridTestMutation = useMutation({
    mutationFn: () =>
      testSendGridConnection({
        sendgrid_api_key: form.sendgrid_api_key === '(set)' ? '' : form.sendgrid_api_key,
      }),
  });

  useEffect(() => {
    smtpTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear when SMTP fields change
  }, [form.email_provider, form.smtp_host, form.smtp_port, form.smtp_secure, form.smtp_user, form.smtp_password]);

  useEffect(() => {
    sendgridTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear when SendGrid fields change
  }, [form.email_provider, form.sendgrid_api_key]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveNotice(null);
    mutation.mutate();
  }

  if (isLoading || (!settings && isFetching)) return <FullPageLoading />;
  if (isError) return <p className={styles.error}>Failed to load settings.</p>;

  const modelPlaceholder =
    form.llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : OLLAMA_DEFAULT_MODEL;

  const isTestSuccess = testMutation.data?.ok === true;
  const testResultMessage =
    testMutation.data?.ok === true
      ? 'Connection successful'
      : (testMutation.data?.error ?? testMutation.error?.message ?? 'Connection failed');

  const isWhisperTestSuccess = whisperTestMutation.data?.ok === true;
  const whisperTestResultMessage =
    whisperTestMutation.data?.ok === true
      ? 'Connection successful'
      : (whisperTestMutation.data?.error ?? whisperTestMutation.error?.message ?? 'Connection failed');

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Settings</h1>
        <p className={styles.heroSub}>Control your server configuration and access settings.</p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Access & General</h2>
          <div className={styles.cardBody}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.registration_enabled}
                onChange={(e) => setForm((f) => ({ ...f, registration_enabled: e.target.checked }))}
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
                onChange={(e) => setForm((f) => ({ ...f, public_feeds_enabled: e.target.checked }))}
              />
              <span className="toggle__track" aria-hidden="true" />
              <span>Enable Public Feeds</span>
            </label>
            <p className={styles.toggleHelp}>
              When disabled, public feed pages and RSS endpoints are hidden and require login to access the app.
            </p>

            <label className={styles.label}>
              Hostname
              <input
                type="url"
                className={styles.input}
                placeholder="https://example.com"
                value={form.hostname}
                onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
              />
              <p className={styles.inputHelp}>
                Base URL for RSS feed enclosures when hosting audio files on this server. Used if no S3 export is configured.
              </p>
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Default Limits for New Users</h2>
          <p className={styles.cardSub}>
            Optional. When set, new users get these limits. Leave empty for no limit.
          </p>
          <div className={styles.cardBody}>
            <label className={styles.label}>
              Default max podcasts
              <input
                type="number"
                min={0}
                step={1}
                className={styles.input}
                placeholder="No limit"
                value={form.default_max_podcasts ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, default_max_podcasts: v === '' ? null : Number(v) }));
                }}
              />
            </label>
            <label className={styles.label}>
              Default max episodes
              <input
                type="number"
                min={0}
                step={1}
                className={styles.input}
                placeholder="No limit"
                value={form.default_max_episodes ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, default_max_episodes: v === '' ? null : Number(v) }));
                }}
              />
            </label>
            <label className={styles.label}>
              Default storage space (MB)
              <input
                type="number"
                min={0}
                step={1}
                className={styles.input}
                placeholder="No limit"
                value={form.default_storage_mb ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, default_storage_mb: v === '' ? null : Number(v) }));
                }}
              />
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Final Episode Output</h2>
          <p className={styles.cardSub}>Choose the format and quality for the final audio file.</p>
          <div className={styles.cardBody}>
            <label className={styles.label}>
              Bitrate (kbps)
              <input
                type="number"
                min={16}
                max={320}
                step={1}
                className={styles.input}
                value={form.final_bitrate_kbps}
                onChange={(e) => setForm((f) => ({ ...f, final_bitrate_kbps: Number(e.target.value) }))}
              />
            </label>

            <div className={styles.label}>
              Channels
              <div className={styles.llmToggle} role="group" aria-label="Output channels">
                <button
                  type="button"
                  className={form.final_channels === 'mono' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                  onClick={() => setForm((f) => ({ ...f, final_channels: 'mono' }))}
                >
                  Mono
                </button>
                <button
                  type="button"
                  className={form.final_channels === 'stereo' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                  onClick={() => setForm((f) => ({ ...f, final_channels: 'stereo' }))}
                >
                  Stereo
                </button>
              </div>
            </div>

            <div className={styles.label}>
              Format
              <div className={styles.llmToggle} role="group" aria-label="Output format">
                <button
                  type="button"
                  className={form.final_format === 'mp3' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                  onClick={() => setForm((f) => ({ ...f, final_format: 'mp3' }))}
                >
                  MP3
                </button>
                <button
                  type="button"
                  className={form.final_format === 'm4a' ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                  onClick={() => setForm((f) => ({ ...f, final_format: 'm4a' }))}
                >
                  M4A
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>GeoLite2 / MaxMind</h2>
          <p className={styles.cardSub}>
            Optional. When Account ID and License Key are set and saved, the server will run the GeoIP Update program
            to download GeoLite2-Country and GeoLite2-City into the data folder. Requires{' '}
            <a
              href="https://github.com/maxmind/geoipupdate/releases"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              geoipupdate
            </a>{' '}
            to be installed on the server.
          </p>
          <div className={styles.cardBody}>
            <label className={styles.label}>
              MaxMind Account ID
              <input
                type="text"
                className={styles.input}
                placeholder="123456"
                value={form.maxmind_account_id}
                onChange={(e) => setForm((f) => ({ ...f, maxmind_account_id: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className={styles.label}>
              MaxMind License Key
              <input
                type="password"
                className={styles.input}
                placeholder={form.maxmind_license_key === '(set)' ? '(saved)' : 'Enter license key'}
                value={form.maxmind_license_key === '(set)' ? '' : form.maxmind_license_key}
                onChange={(e) => setForm((f) => ({ ...f, maxmind_license_key: e.target.value }))}
                autoComplete="off"
              />
            </label>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Whisper ASR</h2>
          <p className={styles.cardSub}>
            Runs the transcription service. See{' '}
            <a
              href="https://github.com/ahmetoner/whisper-asr-webservice"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              whisper-asr-webservice
            </a>
            .
          </p>
          <div className={styles.cardBody}>
            <label className={styles.label}>
              OpenAI Whisper ASR Webservice API URL
              <input
                type="url"
                className={styles.input}
                placeholder="https://..."
                value={form.whisper_asr_url}
                onChange={(e) => setForm((f) => ({ ...f, whisper_asr_url: e.target.value }))}
              />
            </label>
            <div className={styles.testBlock}>
              {(whisperTestMutation.data != null || whisperTestMutation.error != null) && (
                <div
                  className={isWhisperTestSuccess ? styles.noticeSuccess : styles.noticeError}
                  role="status"
                  aria-live="polite"
                >
                  <span className={styles.noticeTitle}>{isWhisperTestSuccess ? 'Success' : 'Error'}</span>
                  <p className={styles.noticeBody}>{whisperTestResultMessage}</p>
                </div>
              )}
              <div className={styles.testRow}>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={() => whisperTestMutation.mutate()}
                  disabled={whisperTestMutation.isPending}
                >
                  {whisperTestMutation.isPending ? 'Testing…' : 'Test'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>LLM</h2>
          <p className={styles.cardSub}>
            Optional. Used for AI-powered features such as chapter generation and summarization. Connect to Ollama (local)
            or OpenAI.
          </p>
          <div className={styles.cardBody}>
            <div className={styles.label}>
              LLM Provider
              <div className={styles.llmToggle} role="group" aria-label="LLM provider">
                {LLM_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={form.llm_provider === value ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        llm_provider: value,
                        model:
                          value === 'openai' ? OPENAI_DEFAULT_MODEL : value === 'ollama' ? OLLAMA_DEFAULT_MODEL : f.model,
                      }));
                      testMutation.reset();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {form.llm_provider === 'ollama' ? (
              <label className={styles.label}>
                Ollama URL
                <input
                  type="url"
                  className={styles.input}
                  placeholder="http://localhost:11434"
                  value={form.ollama_url}
                  onChange={(e) => setForm((f) => ({ ...f, ollama_url: e.target.value }))}
                />
              </label>
            ) : form.llm_provider === 'openai' ? (
              <label className={styles.label}>
                OpenAI API key
                <input
                  type="password"
                  className={styles.input}
                  placeholder={form.openai_api_key === '(set)' ? '(saved)' : 'sk-...'}
                  value={form.openai_api_key === '(set)' ? '' : form.openai_api_key}
                  onChange={(e) => setForm((f) => ({ ...f, openai_api_key: e.target.value }))}
                  autoComplete="off"
                />
              </label>
            ) : null}

            {form.llm_provider !== 'none' && (
              <>
                <label className={styles.label}>
                  Model
                  <input
                    type="text"
                    className={styles.input}
                    placeholder={modelPlaceholder}
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  />
                </label>
                {(testMutation.data != null || testMutation.error != null) && (
                  <div
                    className={isTestSuccess ? styles.noticeSuccess : styles.noticeError}
                    role="status"
                    aria-live="polite"
                  >
                    <span className={styles.noticeTitle}>{isTestSuccess ? 'Success' : 'Error'}</span>
                    <p className={styles.noticeBody}>{testResultMessage}</p>
                  </div>
                )}
                <div className={styles.testRow}>
                  <button
                    type="button"
                    className={styles.testBtn}
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending}
                  >
                    {testMutation.isPending ? 'Testing…' : 'Test'}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>CAPTCHA (Sign-In & Registration)</h2>
          <p className={styles.cardSub}>
            Optional. When enabled, users must complete a CAPTCHA when signing in or registering.
          </p>
          <div className={styles.cardBody}>
            <div className={styles.label}>
              Provider
              <div className={`${styles.llmToggle} ${styles.captchaProviderToggle}`} role="group" aria-label="CAPTCHA provider">
                {CAPTCHA_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={form.captcha_provider === value ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                    onClick={() => setForm((f) => ({ ...f, captcha_provider: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
                    onChange={(e) => setForm((f) => ({ ...f, captcha_site_key: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, captcha_secret_key: e.target.value }))}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Email</h2>
          <p className={styles.cardSub}>
            Optional. Configure how the server sends email (e.g. for notifications or password reset). Choose None to disable.
          </p>
          <div className={styles.cardBody}>
            <div className={styles.label}>
              Provider
              <div className={styles.llmToggle} role="group" aria-label="Email provider">
                {EMAIL_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={form.email_provider === value ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                    onClick={() => setForm((f) => ({ ...f, email_provider: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
                    onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, smtp_port: Number(e.target.value) || 587 }))}
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={form.smtp_secure}
                    onChange={(e) => setForm((f) => ({ ...f, smtp_secure: e.target.checked }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, smtp_user: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, smtp_password: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, smtp_from: e.target.value }))}
                    autoComplete="off"
                  />
                  <p className={styles.inputHelp}>Email address used as the sender for outgoing mail.</p>
                </label>
                <div className={styles.testBlock}>
                  {(smtpTestMutation.data != null || smtpTestMutation.error != null) && (
                    <div
                      className={smtpTestMutation.data?.ok ? styles.noticeSuccess : styles.noticeError}
                      role="status"
                      aria-live="polite"
                    >
                      <span className={styles.noticeTitle}>
                        {smtpTestMutation.data?.ok ? 'Success' : 'Error'}
                      </span>
                      <p className={styles.noticeBody}>
                        {smtpTestMutation.data?.ok
                          ? 'Credentials verified.'
                          : (smtpTestMutation.data?.error ?? smtpTestMutation.error?.message ?? 'Verification failed')}
                      </p>
                    </div>
                  )}
                  <div className={styles.testRow}>
                    <button
                      type="button"
                      className={styles.testBtn}
                      onClick={() => smtpTestMutation.mutate()}
                      disabled={smtpTestMutation.isPending}
                    >
                      {smtpTestMutation.isPending ? 'Testing…' : 'Test'}
                    </button>
                  </div>
                </div>
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
                    onChange={(e) => setForm((f) => ({ ...f, sendgrid_api_key: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, sendgrid_from: e.target.value }))}
                    autoComplete="off"
                  />
                  <p className={styles.inputHelp}>Verified sender in SendGrid. Used as the sender for outgoing mail.</p>
                </label>
                <div className={styles.testBlock}>
                  {(sendgridTestMutation.data != null || sendgridTestMutation.error != null) && (
                    <div
                      className={sendgridTestMutation.data?.ok ? styles.noticeSuccess : styles.noticeError}
                      role="status"
                      aria-live="polite"
                    >
                      <span className={styles.noticeTitle}>
                        {sendgridTestMutation.data?.ok ? 'Success' : 'Error'}
                      </span>
                      <p className={styles.noticeBody}>
                        {sendgridTestMutation.data?.ok
                          ? 'API key verified.'
                          : (sendgridTestMutation.data?.error ?? sendgridTestMutation.error?.message ?? 'Verification failed')}
                      </p>
                    </div>
                  )}
                  <div className={styles.testRow}>
                    <button
                      type="button"
                      className={styles.testBtn}
                      onClick={() => sendgridTestMutation.mutate()}
                      disabled={sendgridTestMutation.isPending}
                    >
                      {sendgridTestMutation.isPending ? 'Testing…' : 'Test'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {saveNotice?.type === 'success' && (
          <div className={styles.noticeSuccess} role="status" aria-live="polite">
            <span className={styles.noticeTitle}>Success</span>
            <p className={styles.noticeBody}>{saveNotice.message}</p>
          </div>
        )}
        {saveNotice?.type === 'error' && (
          <div className={styles.noticeError} role="alert" aria-live="polite">
            <span className={styles.noticeTitle}>Error</span>
            <p className={styles.noticeBody}>{saveNotice.message}</p>
          </div>
        )}

        <div className={styles.actions}>
          <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Save settings">
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
