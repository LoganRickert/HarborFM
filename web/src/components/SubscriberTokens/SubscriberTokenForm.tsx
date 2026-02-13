import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { createSubscriberToken } from '../../api/podcasts';
import { formatDateForInput } from '../../utils/datetime';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokenFormProps {
  podcastId: string;
  atLimit: boolean;
  limitValue?: number | null;
  onSuccess: (token: string) => void;
}

export function SubscriberTokenForm({ podcastId, atLimit, limitValue, onSuccess }: SubscriberTokenFormProps) {
  const queryClient = useQueryClient();
  const [createName, setCreateName] = useState('');
  const [createValidFrom, setCreateValidFrom] = useState('');
  const [createExpires, setCreateExpires] = useState(true);
  const [createValidUntil, setCreateValidUntil] = useState(() => {
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return formatDateForInput(oneYearFromNow);
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; valid_from?: string; valid_until?: string }) =>
      createSubscriberToken(podcastId, body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['subscriber-tokens', podcastId] });
      queryClient.invalidateQueries({ queryKey: ['subscriber-tokens-count', podcastId] });
      onSuccess(res.token);
      setCreateName('');
      setCreateValidFrom('');
      setCreateExpires(true);
      const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      setCreateValidUntil(formatDateForInput(oneYearFromNow));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    
    // Convert local datetime inputs to UTC ISO strings for server
    const validFromUtc = createValidFrom.trim() ? new Date(createValidFrom).toISOString() : undefined;
    const validUntilUtc = (createExpires && createValidUntil.trim()) ? new Date(createValidUntil).toISOString() : undefined;
    
    createMutation.mutate({
      name: createName.trim(),
      ...(validFromUtc ? { valid_from: validFromUtc } : {}),
      ...(validUntilUtc ? { valid_until: validUntilUtc } : {}),
    });
  };

  return (
    <form className={styles.tokenForm} onSubmit={handleSubmit}>
      <div className={styles.tokenFormInputWrap}>
        <input
          type="text"
          placeholder="Token name (e.g. Subscriber name)"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          className={styles.tokenFormInput}
          disabled={atLimit}
          required
        />
      </div>
      <div className={styles.tokenFormActions} data-expires={createExpires}>
        <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={createExpires}
            disabled={atLimit}
            onChange={(e) => setCreateExpires(e.target.checked)}
          />
          <span className="toggle__track" aria-hidden="true" />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Expires</span>
        </label>
        {createExpires && (
          <input
            type="datetime-local"
            placeholder="Valid until"
            disabled={atLimit}
            value={createValidUntil}
            onChange={(e) => setCreateValidUntil(e.target.value)}
            className={styles.tokenFormInput}
          />
        )}
        <button
          type="submit"
          className={styles.createTokenBtn}
          disabled={createMutation.isPending || atLimit}
          title={atLimit ? `You're at max subscriber tokens for this show (${limitValue})` : undefined}
        >
          <Plus size={16} strokeWidth={2} aria-hidden />
          {createMutation.isPending ? 'Creating...' : 'Create Token'}
        </button>
      </div>
      {createMutation.isError && (
        <p className={styles.error}>{(createMutation.error as Error).message}</p>
      )}
      {atLimit && (
        <p className={styles.error}>
          You&apos;re at max subscriber tokens for this show ({limitValue}). Delete a token to create a new one.
        </p>
      )}
    </form>
  );
}
