import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  testLlmConnection,
  testWhisperConnection,
  testTranscriptionOpenAI,
  testSmtpConnection,
  testSendGridConnection,
  geoliteTest,
  geoliteCheck,
  geoliteUpdate,
  AppSettings,
} from '../api/settings';

interface UseSettingsMutationsParams {
  form: AppSettings;
}

export function useSettingsMutations({ form }: UseSettingsMutationsParams) {
  // LLM test mutation
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

  // Reset LLM test when provider changes
  useEffect(() => {
    testMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.llm_provider]);

  // Whisper test mutation
  const whisperTestMutation = useMutation({
    mutationFn: () => testWhisperConnection(form.whisper_asr_url),
  });

  // Reset Whisper test when URL changes
  useEffect(() => {
    whisperTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.whisper_asr_url]);

  // OpenAI transcription test mutation
  const transcriptionOpenaiTestMutation = useMutation({
    mutationFn: () =>
      testTranscriptionOpenAI({
        openai_transcription_url: form.openai_transcription_url?.trim() || undefined,
        openai_transcription_api_key: form.openai_transcription_api_key === '(set)' ? undefined : form.openai_transcription_api_key?.trim() || undefined,
      }),
  });

  useEffect(() => {
    transcriptionOpenaiTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.openai_transcription_url, form.openai_transcription_api_key]);

  // SMTP test mutation
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

  // SendGrid test mutation
  const sendgridTestMutation = useMutation({
    mutationFn: () =>
      testSendGridConnection({
        sendgrid_api_key: form.sendgrid_api_key === '(set)' ? '' : form.sendgrid_api_key,
      }),
  });

  // Reset SMTP test when SMTP fields change
  useEffect(() => {
    smtpTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.email_provider,
    form.smtp_host,
    form.smtp_port,
    form.smtp_secure,
    form.smtp_user,
    form.smtp_password,
  ]);

  // Reset SendGrid test when SendGrid fields change
  useEffect(() => {
    sendgridTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.email_provider, form.sendgrid_api_key]);

  // GeoLite mutations
  const geoliteTestMutation = useMutation({
    mutationFn: (payload: { maxmind_account_id: string; maxmind_license_key?: string }) =>
      geoliteTest(payload),
  });

  const geoliteCheckMutation = useMutation({
    mutationFn: geoliteCheck,
  });

  const geoliteUpdateMutation = useMutation({
    mutationFn: (payload: { maxmind_account_id: string; maxmind_license_key?: string }) =>
      geoliteUpdate(payload),
    onSuccess: () => {
      geoliteCheckMutation.mutate();
    },
  });

  return {
    testMutation,
    whisperTestMutation,
    transcriptionOpenaiTestMutation,
    smtpTestMutation,
    sendgridTestMutation,
    geoliteTestMutation,
    geoliteCheckMutation,
    geoliteUpdateMutation,
  };
}
