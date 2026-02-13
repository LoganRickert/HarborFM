import { TranscriptionSectionProps, ProviderOption } from '../../types/settings';
import { SectionCard } from './SectionCard';
import { ProviderToggle } from './ProviderToggle';
import { TestBlock } from './TestBlock';
import { AppSettings } from '../../api/settings';
import styles from '../../pages/Settings.module.css';

const TRANSCRIPTION_PROVIDER_OPTIONS: ProviderOption<AppSettings['transcription_provider']>[] = [
  { value: 'none', label: 'None' },
  { value: 'self_hosted', label: 'Self-Hosted' },
  { value: 'openai', label: 'OpenAI' },
];

export function WhisperSection({
  form,
  onFormChange,
  whisperTestMutation,
  onWhisperTest,
  transcriptionOpenaiTestMutation,
  onTranscriptionOpenaiTest,
}: TranscriptionSectionProps) {
  return (
    <SectionCard
      title="Transcription"
      subtitle="Generate episode and segment transcripts. Self-Hosted uses a Whisper ASR service; OpenAI uses the Audio API."
    >
      <div className={styles.label}>
        Transcription Provider
        <ProviderToggle
          value={form.transcription_provider}
          options={TRANSCRIPTION_PROVIDER_OPTIONS}
          onChange={(value) => onFormChange({ transcription_provider: value })}
          ariaLabel="Transcription provider"
        />
      </div>

      {form.transcription_provider === 'self_hosted' && (
        <>
          <label className={styles.label}>
            Whisper ASR URL
            <input
              type="url"
              className={styles.input}
              placeholder="http://whisper:9000"
              value={form.whisper_asr_url}
              onChange={(e) => onFormChange({ whisper_asr_url: e.target.value })}
            />
          </label>
          <TestBlock
            testMutation={whisperTestMutation}
            onTest={onWhisperTest}
            successMessage="Connection successful"
          />
        </>
      )}

      {form.transcription_provider === 'openai' && (
        <>
          <label className={styles.label}>
            OpenAI transcription API URL (optional)
            <input
              type="url"
              className={styles.input}
              placeholder="https://api.openai.com/v1/audio/transcriptions"
              value={form.openai_transcription_url}
              onChange={(e) => onFormChange({ openai_transcription_url: e.target.value })}
            />
          </label>
          <label className={styles.label}>
            OpenAI API key (required for transcription)
            <input
              type="password"
              className={styles.input}
              placeholder={form.openai_transcription_api_key === '(set)' ? '(set)' : 'sk-...'}
              value={form.openai_transcription_api_key === '(set)' ? '' : form.openai_transcription_api_key}
              onChange={(e) => onFormChange({ openai_transcription_api_key: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className={styles.label}>
            Transcription model
            <input
              type="text"
              className={styles.input}
              placeholder="whisper-1"
              value={form.transcription_model}
              onChange={(e) => onFormChange({ transcription_model: e.target.value })}
            />
            <span className={styles.inputHelp}>
              <span className={styles.modelName}>whisper-1</span> is $0.06/min and provides timestamps.{' '}
              <span className={styles.modelName}>gpt-4o-mini-transcribe</span> is $0.03/min but does not provide timestamps.
            </span>
          </label>
          <TestBlock
            testMutation={transcriptionOpenaiTestMutation}
            onTest={onTranscriptionOpenaiTest}
            successMessage="API key valid"
          />
        </>
      )}
    </SectionCard>
  );
}
