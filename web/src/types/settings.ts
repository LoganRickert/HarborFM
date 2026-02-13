import { AppSettings } from '../api/settings';
import { UseMutationResult } from '@tanstack/react-query';

export interface SettingsFormProps {
  form: AppSettings;
  onFormChange: (updates: Partial<AppSettings>) => void;
}

export interface ProviderOption<T = string> {
  value: T;
  label: string;
}

export interface SectionCardProps {
  title: string;
  subtitle: string | React.ReactNode;
  children: React.ReactNode;
}

export interface ProviderToggleProps<T = string> {
  value: T;
  options: ProviderOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

export interface TestBlockProps {
  testMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onTest: () => void;
  disabled?: boolean;
  successMessage: string;
  testLabel?: string;
}

export interface GeoliteSectionProps extends SettingsFormProps {
  geoliteTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, { maxmind_account_id: string; maxmind_license_key?: string }, unknown>;
  geoliteCheckMutation: UseMutationResult<{ city: boolean; country: boolean } | undefined, Error, void, unknown>;
  geoliteUpdateMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, { maxmind_account_id: string; maxmind_license_key?: string }, unknown>;
  onGeoliteTest: () => void;
  onGeoliteCheck: () => void;
  onGeoliteUpdate: () => void;
}

export interface WhisperSectionProps extends SettingsFormProps {
  whisperTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onWhisperTest: () => void;
}

export interface TranscriptionSectionProps extends SettingsFormProps {
  whisperTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onWhisperTest: () => void;
  transcriptionOpenaiTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onTranscriptionOpenaiTest: () => void;
}

export interface LLMSectionProps extends SettingsFormProps {
  testMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onTest: () => void;
  onProviderChange: (provider: AppSettings['llm_provider']) => void;
}

export interface EmailSectionProps extends SettingsFormProps {
  smtpTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  sendgridTestMutation: UseMutationResult<{ ok: boolean; error?: string }, Error, void, unknown>;
  onSmtpTest: () => void;
  onSendGridTest: () => void;
}

export interface AccessGeneralSectionProps extends SettingsFormProps {
  welcomeBannerRef: React.RefObject<HTMLTextAreaElement | null>;
  onResizeWelcomeBanner: () => void;
}
