import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, testLlmConnection, type AppSettings } from '../api/settings';
import { FullPageLoading } from '../components/Loading';
import styles from './Settings.module.css';

const OLLAMA_DEFAULT_MODEL = 'llama3.2:latest';
const OPENAI_DEFAULT_MODEL = 'gpt-5-mini';

const LLM_OPTIONS: { value: AppSettings['llm_provider']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
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
    mutationFn: () =>
      testLlmConnection({
        llm_provider: form.llm_provider as 'ollama' | 'openai',
        ollama_url: form.ollama_url,
        openai_api_key: form.openai_api_key === '(set)' ? undefined : form.openai_api_key,
      }),
  });

  useEffect(() => {
    testMutation.reset();
  }, [form.llm_provider, testMutation]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveNotice(null);
    mutation.mutate();
  }

  if (isLoading || (!settings && isFetching)) return <FullPageLoading />;
  if (isError) return <p className={styles.error}>Failed to load settings.</p>;

  const modelPlaceholder =
    form.llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : OLLAMA_DEFAULT_MODEL;

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>
        ← Home
      </Link>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Settings</h1>
        <p className={styles.heroSub}>Control your server configuration and access settings.</p>
      </header>

      <div className={styles.card}>
        <form onSubmit={handleSubmit} className={styles.form}>
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
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              Base URL for RSS feed enclosures when hosting audio files on this server. Used if no S3 export is configured.
            </p>
          </label>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Final episode output</h2>
            <p className={styles.sectionSub}>Choose the format and quality for the final audio file.</p>

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

            <div className={`${styles.label} ${styles.labelSpacing}`}>
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

            <div className={`${styles.label} ${styles.labelSpacing}`}>
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

          <hr className={styles.divider} />

          <label className={styles.label}>
            OpenAI Whisper ASR Webservice API URL
            <input
              type="url"
              className={styles.input}
              placeholder="https://..."
              value={form.whisper_asr_url}
              onChange={(e) => setForm((f) => ({ ...f, whisper_asr_url: e.target.value }))}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginLeft: '0' }}>
              Runs the transcription service. See{' '}
              <a
                href="https://github.com/ahmetoner/whisper-asr-webservice"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
              >
                whisper-asr-webservice
              </a>
              .
            </p>
          </label>

          <div className={styles.label}>
            LLM provider
            <div className={styles.llmToggle} role="group" aria-label="LLM provider">
              {LLM_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={form.llm_provider === value ? styles.llmToggleBtnActive : styles.llmToggleBtn}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      llm_provider: value,
                      model:
                        value === 'openai' ? OPENAI_DEFAULT_MODEL : value === 'ollama' ? OLLAMA_DEFAULT_MODEL : f.model,
                    }))
                  }
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
              <div className={styles.testRow}>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? 'Testing…' : 'Test'}
                </button>
                {testMutation.data && (
                  <span className={testMutation.data.ok ? styles.testSuccess : styles.testError}>
                    {testMutation.data.ok ? 'Connection successful' : (testMutation.data.error ?? '')}
                  </span>
                )}
              </div>
            </>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.submit} disabled={mutation.isPending} aria-label="Save settings">
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
