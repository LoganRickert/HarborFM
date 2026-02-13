import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSubscriberToken, type SubscriberToken } from '../../api/podcasts';
import { formatDateForInput } from '../../utils/datetime';
import { TokenListRow, type TokenStatus } from '../TokenListRow';
import localStyles from './SubscriberTokens.module.css';
import sharedStyles from '../PodcastDetail/shared.module.css';

const styles = { ...sharedStyles, ...localStyles };

interface SubscriberTokensListProps {
  tokens: SubscriberToken[];
  podcastId: string;
  readOnly: boolean;
  onDelete: (token: SubscriberToken) => void;
}

function getStatus(token: SubscriberToken): TokenStatus {
  const expired = token.valid_until != null && new Date(token.valid_until) < new Date();
  if (expired) return 'expired';
  if (token.disabled) return 'disabled';
  return 'active';
}

function getMetaText(t: SubscriberToken): string {
  const parts = [`Created ${new Date(t.created_at).toLocaleDateString()}`];
  if (t.valid_until) parts.push(`Expires ${new Date(t.valid_until).toLocaleDateString()}`);
  if (t.last_used_at) parts.push(`Last used ${new Date(t.last_used_at).toLocaleDateString()}`);
  return parts.join(' · ');
}

export function SubscriberTokensList({ tokens, podcastId, readOnly, onDelete }: SubscriberTokensListProps) {
  const queryClient = useQueryClient();
  const [extendTokenId, setExtendTokenId] = useState<string | null>(null);
  const [extendValidUntil, setExtendValidUntil] = useState('');

  const updateMutation = useMutation({
    mutationFn: ({ tokenId, body }: { tokenId: string; body: { disabled?: boolean; valid_until?: string; valid_from?: string } }) =>
      updateSubscriberToken(podcastId, tokenId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriber-tokens', podcastId] });
      setExtendTokenId(null);
      setExtendValidUntil('');
    },
  });

  return (
    <ul className={styles.exportList}>
      {tokens.map((t) => (
        <TokenListRow
          key={t.id}
          name={t.name}
          status={getStatus(t)}
          metaText={getMetaText(t)}
          readOnly={readOnly}
          extendEditing={extendTokenId === t.id}
          extendValue={extendValidUntil}
          onExtendValueChange={setExtendValidUntil}
          onExtendSave={() => {
            if (extendValidUntil.trim()) {
              const utcString = new Date(extendValidUntil).toISOString();
              updateMutation.mutate({ tokenId: t.id, body: { valid_until: utcString } });
            }
          }}
          onExtendCancel={() => {
            setExtendTokenId(null);
            setExtendValidUntil('');
          }}
          onExtendClick={() => {
            setExtendTokenId(t.id);
            const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            setExtendValidUntil(formatDateForInput(oneYearFromNow));
          }}
          onEnableDisable={() => updateMutation.mutate({ tokenId: t.id, body: { disabled: !t.disabled } })}
          enableDisableDisabled={updateMutation.isPending || getStatus(t) === 'expired'}
          onRevoke={() => onDelete(t)}
          revokeDisabled={false}
          updatePending={updateMutation.isPending}
          revokeLabel="Delete"
        />
      ))}
    </ul>
  );
}
