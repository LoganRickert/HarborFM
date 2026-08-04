import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, X } from 'lucide-react';
import {
  CAST_SOCIAL_LINKS_MAX,
  normalizeCastSocialLinks,
} from '@harborfm/shared';
import {
  approveCastProfilePending,
  castPhotoUrl,
  disregardCastProfilePending,
  getCastProfilePending,
  type CastMember,
} from '../../api/podcasts';
import { resizeCastProfilePhoto } from '../../utils/resizeCastProfilePhoto';
import { ianaTimeZoneSelectOptions } from '../../utils/ianaTimeZones';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

type SocialLinkRow = { id: string; url: string };

function newSocialRow(url = ''): SocialLinkRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    url,
  };
}

function rowsFromUrls(urls: string[]): SocialLinkRow[] {
  return normalizeCastSocialLinks(urls).map((url) => newSocialRow(url));
}

function SortableSocialLinkRow({
  row,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  row: SocialLinkRow;
  index: number;
  disabled: boolean;
  onChange: (id: string, url: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={styles.castSocialLinkRow}>
      <button
        type="button"
        className={styles.castSocialLinkDrag}
        aria-label={`Drag to reorder link ${index + 1}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <input
        type="url"
        value={row.url}
        onChange={(e) => onChange(row.id, e.target.value)}
        className={styles.castDialogFormInput}
        placeholder="https://instagram.com/username"
        disabled={disabled}
        aria-label={`Social link ${index + 1}`}
      />
      <button
        type="button"
        className={styles.castSocialLinkRemove}
        onClick={() => onRemove(row.id)}
        disabled={disabled}
        aria-label={`Remove link ${index + 1}`}
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function currentPhotoSrc(member: CastMember, podcastId: string): string | null {
  if (member.photoUrl?.trim()) return member.photoUrl.trim();
  if (member.photoFilename) {
    return castPhotoUrl(podcastId, member.id, member.photoFilename);
  }
  return null;
}

interface CastProfilePendingDialogProps {
  cast: CastMember | null;
  podcastId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CastProfilePendingDialog({
  cast,
  podcastId,
  isOpen,
  onClose,
  onSuccess,
}: CastProfilePendingDialogProps) {
  const castId = cast?.id ?? '';
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['cast-profile-pending', podcastId, castId],
    queryFn: () => getCastProfilePending(podcastId, castId),
    enabled: isOpen && !!castId,
  });

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [description, setDescription] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [socialLinkRows, setSocialLinkRows] = useState<SocialLinkRow[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data || !castId) return;
    const key = `${castId}:${data.pending.updatedAt}`;
    if (hydratedKey === key) return;
    setName(data.pending.name || '');
    setNickname(data.pending.nickname || '');
    setDescription(data.pending.description || '');
    setTimeZone(data.pending.timeZone || '');
    setSocialLinkRows(rowsFromUrls(data.pending.socialLinks || []));
    setPhotoPreview(data.pending.photoUrl || currentPhotoSrc(data.current, podcastId));
    setPhotoFile(null);
    setHydratedKey(key);
  }, [data, castId, podcastId, hydratedKey]);

  useEffect(() => {
    if (!photoFile) return;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const approveMutation = useMutation({
    mutationFn: async () => {
      let photo: File | null = photoFile;
      if (photo) photo = await resizeCastProfilePhoto(photo);
      return approveCastProfilePending(podcastId, castId, {
        name: name.trim(),
        nickname: nickname.trim(),
        description: description.trim(),
        socialLinks: normalizeCastSocialLinks(socialLinkRows.map((r) => r.url)),
        timeZone: timeZone.trim() || null,
        photo,
      });
    },
    onSuccess: () => {
      setError(null);
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to save');
    },
  });

  const disregardMutation = useMutation({
    mutationFn: () => disregardCastProfilePending(podcastId, castId),
    onSuccess: () => {
      setError(null);
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to disregard');
    },
  });

  const busy = approveMutation.isPending || disregardMutation.isPending;
  const current = data?.current;
  const canAddSocialLink = socialLinkRows.length < CAST_SOCIAL_LINKS_MAX;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.castPendingDialog}`}>
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              Review Profile Update
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={busy}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            Proposed changes are editable. Save applies them to the cast profile
            and emails the cast member. Disregard discards the proposal without
            emailing them.
          </Dialog.Description>

          {isLoading ? (
            <p className={styles.pdCardEmptyState}>Loading...</p>
          ) : loadError ? (
            <p className={styles.error} role="alert">
              {loadError instanceof Error
                ? loadError.message
                : 'Failed to load pending update'}
            </p>
          ) : (
            <div className={styles.castPendingCompare}>
              {current ? (
                <div className={styles.castPendingCurrent}>
                  <h3 className={styles.castPendingSectionTitle}>Current</h3>
                  <p>
                    <strong>{current.name}</strong>
                    {current.nickname ? ` (${current.nickname})` : ''}
                  </p>
                  <p className={styles.castPendingMuted}>
                    {current.description || 'No description'}
                  </p>
                  <p className={styles.castPendingMuted}>
                    Time zone: {current.timeZone?.trim() || 'Not set'}
                  </p>
                  {currentPhotoSrc(current, podcastId) ? (
                    <img
                      src={currentPhotoSrc(current, podcastId)!}
                      alt=""
                      className={styles.castPendingThumb}
                    />
                  ) : null}
                  <ul className={styles.castPendingLinks}>
                    {(current.socialLinks || []).map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className={styles.castPendingProposed}>
                <h3 className={styles.castPendingSectionTitle}>Proposed</h3>
                <label className={styles.castDialogFormLabel}>
                  Preferred Name
                  <input
                    className={styles.castDialogFormInput}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className={styles.castDialogFormLabel}>
                  Nickname
                  <input
                    className={styles.castDialogFormInput}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className={styles.castDialogFormLabel}>
                  Description
                  <textarea
                    className={styles.castDialogFormInput}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                    rows={3}
                  />
                </label>
                <label className={styles.castDialogFormLabel}>
                  Time Zone
                  <select
                    className={styles.castDialogFormInput}
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Not set</option>
                    {ianaTimeZoneSelectOptions(timeZone).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.castPendingPhotoEdit}>
                  {photoPreview ? (
                    <img src={photoPreview} alt="" className={styles.castPendingThumb} />
                  ) : (
                    <div className={styles.castPendingThumbPlaceholder}>No photo</div>
                  )}
                  <div className={styles.castPendingPhotoControls}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className={styles.castPendingFileInputHidden}
                      disabled={busy}
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className={styles.castPendingChoosePhotoBtn}
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose Photo
                    </button>
                    {photoFile ? (
                      <span className={styles.castPendingPhotoFileName}>{photoFile.name}</span>
                    ) : (
                      <span className={styles.castPendingPhotoFileNameMuted}>
                        No file selected
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className={styles.castDialogFormLabel}>Social links</span>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      setSocialLinkRows((rows) => {
                        const oldIndex = rows.findIndex((r) => r.id === active.id);
                        const newIndex = rows.findIndex((r) => r.id === over.id);
                        if (oldIndex < 0 || newIndex < 0) return rows;
                        return arrayMove(rows, oldIndex, newIndex);
                      });
                    }}
                  >
                    <SortableContext
                      items={socialLinkRows.map((r) => r.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className={styles.castSocialLinkList}>
                        {socialLinkRows.map((row, index) => (
                          <SortableSocialLinkRow
                            key={row.id}
                            row={row}
                            index={index}
                            disabled={busy}
                            onChange={(id, url) =>
                              setSocialLinkRows((rows) =>
                                rows.map((r) => (r.id === id ? { ...r, url } : r)),
                              )
                            }
                            onRemove={(id) =>
                              setSocialLinkRows((rows) =>
                                rows.filter((r) => r.id !== id),
                              )
                            }
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  <button
                    type="button"
                    className={styles.castSocialLinkAdd}
                    onClick={() =>
                      setSocialLinkRows((rows) => [...rows, newSocialRow()])
                    }
                    disabled={busy || !canAddSocialLink}
                  >
                    <Plus size={16} aria-hidden />
                    Add Link
                  </button>
                </div>
              </div>
            </div>
          )}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={`${styles.dialogActions} ${styles.dialogActionsCancelLeft}`}>
            <div className={styles.castPendingDialogLeftActions}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.cancel}
                  disabled={busy}
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                disabled={busy || isLoading || !data}
                onClick={() => {
                  setError(null);
                  disregardMutation.mutate();
                }}
                aria-label="Disregard profile update"
              >
                {disregardMutation.isPending ? 'Disregarding...' : 'Disregard'}
              </button>
            </div>
            <button
              type="button"
              className={styles.dialogConfirm}
              disabled={busy || isLoading || !data}
              onClick={() => {
                setError(null);
                if (!name.trim()) {
                  setError('Preferred Name is required');
                  return;
                }
                approveMutation.mutate();
              }}
            >
              {approveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
