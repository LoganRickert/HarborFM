import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { createApiKey, type ApiKeyCreateResponse } from '../../api/apiKeys';
import { formatDateForInput } from '../../utils/datetime';
import tokenStyles from '../SubscriberTokens/SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...tokenStyles };

interface ApiKeyFormProps {
  atLimit: boolean;
  limitValue: number;
  readOnly: boolean;
  onSuccess: (result: ApiKeyCreateResponse) => void;
}

export function ApiKeyForm({ atLimit, limitValue, readOnly, onSuccess }: ApiKeyFormProps) {
  const queryClient = useQueryClient();
  const [createName, setCreateName] = useState('');
  const [createExpires, setCreateExpires] = useState(true);
  const [createValidUntil, setCreateValidUntil] = useState(() => {
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return formatDateForInput(oneYearFromNow);
  });

  const createMutation = useMutation({
    mutationFn: (body: { name?: string; valid_until?: string }) => createApiKey(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['api-keys-count'] });
      onSuccess(result);
      setCreateName('');
      setCreateExpires(true);
      const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      setCreateValidUntil(formatDateForInput(oneYearFromNow));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    const validUntilUtc =
      createExpires && createValidUntil.trim()
        ? new Date(createValidUntil).toISOString()
        : undefined;
    createMutation.mutate({
      name: createName.trim(),
      ...(validUntilUtc ? { valid_until: validUntilUtc } : {}),
    });
  };

  if (readOnly) return null;

  return (
    <form className={styles.tokenForm} onSubmit={handleSubmit}>
      <div className={styles.tokenFormInputWrap}>
        <input
          type="text"
          placeholder="Key name (e.g. Production script)"
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
          title={atLimit ? `You can have at most ${limitValue} API keys. Revoke one to create another.` : undefined}
        >
          <Plus size={16} strokeWidth={2} aria-hidden />
          {createMutation.isPending ? 'Creating...' : 'Create Key'}
        </button>
      </div>
      {createMutation.isError && (
        <p className={styles.error}>{(createMutation.error as Error).message}</p>
      )}
    </form>
  );
}
