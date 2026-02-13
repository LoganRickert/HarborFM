import { LLMSectionProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { TestBlock } from './TestBlock';
import { AppSettings } from '../../api/settings';
import { OLLAMA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL } from '../../hooks/useSettingsForm';
import styles from '../../pages/Settings.module.css';

const LLM_OPTIONS: ProviderOption<AppSettings['llm_provider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
];

export function LLMSection({
  form,
  onFormChange,
  testMutation,
  onTest,
  onProviderChange,
}: LLMSectionProps) {
  const modelPlaceholder =
    form.llm_provider === 'openai' ? OPENAI_DEFAULT_MODEL : OLLAMA_DEFAULT_MODEL;

  return (
    <SectionCard
      title="LLM"
      subtitle="Optional. Used for AI-powered features such as chapter generation and summarization. Connect to Ollama (local) or OpenAI."
    >
      <div className={styles.label}>
        LLM Provider
        <ProviderToggle
          value={form.llm_provider}
          options={LLM_OPTIONS}
          onChange={(value) => {
            onProviderChange(value);
            testMutation.reset();
          }}
          ariaLabel="LLM provider"
        />
      </div>

      {form.llm_provider === 'ollama' ? (
        <label className={styles.label}>
          Ollama URL
          <input
            type="url"
            className={styles.input}
            placeholder="http://localhost:11434"
            value={form.ollama_url}
            onChange={(e) => onFormChange({ ollama_url: e.target.value })}
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
            onChange={(e) => onFormChange({ openai_api_key: e.target.value })}
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
              onChange={(e) => onFormChange({ model: e.target.value })}
            />
          </label>
          <TestBlock
            testMutation={testMutation}
            onTest={onTest}
            successMessage="Connection successful"
          />
        </>
      )}
    </SectionCard>
  );
}
