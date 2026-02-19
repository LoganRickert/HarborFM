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
} from '../api/settings';
import type { SettingsResponse } from '@harborfm/shared';

interface UseSettingsMutationsParams {
  form: SettingsResponse;
}

export function useSettingsMutations({ form }: UseSettingsMutationsParams) {
  // LLM test mutation
  const testMutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof testLlmConnection>[0] = {
        llmProvider: form.llmProvider as 'ollama' | 'openai',
      };
      if (form.llmProvider === 'ollama') payload.ollamaUrl = form.ollamaUrl;
      if (form.llmProvider === 'openai') {
        payload.openaiApiKey = form.openaiApiKey === '(set)' ? undefined : form.openaiApiKey;
      }
      return testLlmConnection(payload);
    },
  });

  // Reset LLM test when provider changes
  useEffect(() => {
    testMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.llmProvider]);

  // Whisper test mutation
  const whisperTestMutation = useMutation({
    mutationFn: () => testWhisperConnection(form.whisperAsrUrl),
  });

  // Reset Whisper test when URL changes
  useEffect(() => {
    whisperTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.whisperAsrUrl]);

  // OpenAI transcription test mutation
  const transcriptionOpenaiTestMutation = useMutation({
    mutationFn: () =>
      testTranscriptionOpenAI({
        openaiTranscriptionUrl: form.openaiTranscriptionUrl?.trim() || undefined,
        openaiTranscriptionApiKey: form.openaiTranscriptionApiKey === '(set)' ? undefined : form.openaiTranscriptionApiKey?.trim() || undefined,
      }),
  });

  useEffect(() => {
    transcriptionOpenaiTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.openaiTranscriptionUrl, form.openaiTranscriptionApiKey]);

  // SMTP test mutation
  const smtpTestMutation = useMutation({
    mutationFn: () =>
      testSmtpConnection({
        smtpHost: form.smtpHost.trim(),
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser.trim(),
        smtpPassword: form.smtpPassword === '(set)' ? '' : form.smtpPassword,
      }),
  });

  // SendGrid test mutation
  const sendgridTestMutation = useMutation({
    mutationFn: () =>
      testSendGridConnection({
        sendgridApiKey: form.sendgridApiKey === '(set)' ? '' : form.sendgridApiKey,
      }),
  });

  // Reset SMTP test when SMTP fields change
  useEffect(() => {
    smtpTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.emailProvider,
    form.smtpHost,
    form.smtpPort,
    form.smtpSecure,
    form.smtpUser,
    form.smtpPassword,
  ]);

  // Reset SendGrid test when SendGrid fields change
  useEffect(() => {
    sendgridTestMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.emailProvider, form.sendgridApiKey]);

  // GeoLite mutations
  const geoliteTestMutation = useMutation({
    mutationFn: (payload: { maxmindAccountId: string; maxmindLicenseKey?: string }) =>
      geoliteTest(payload),
  });

  const geoliteCheckMutation = useMutation({
    mutationFn: geoliteCheck,
  });

  const geoliteUpdateMutation = useMutation({
    mutationFn: (payload: { maxmindAccountId: string; maxmindLicenseKey?: string }) =>
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
