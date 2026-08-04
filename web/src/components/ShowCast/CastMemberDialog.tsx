import { useState, useEffect, useMemo, useRef } from 'react';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { useMutation } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, User, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  createCast,
  updateCast,
  uploadCastPhoto,
  castPhotoUrl,
  type CastMember,
} from '../../api/podcasts';
import {
  CAST_SOCIAL_LINKS_MAX,
  normalizeCastSocialLinks,
  type CastCreate,
} from '@harborfm/shared';
import { UnsavedChangesConfirmDialog } from '../UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../../hooks/useDialogCloseGuard';
import { useBaselineDirty, snapshotForDirty } from '../../hooks/useBaselineDirty';
import { ianaTimeZoneSelectOptions } from '../../utils/ianaTimeZones';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

type SocialLinkRow = { id: string; url: string };

function newSocialRow(url = ''): SocialLinkRow {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `link-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return { id, url };
}

function rowsFromUrls(urls: string[]): SocialLinkRow[] {
  const normalized = normalizeCastSocialLinks(urls);
  return normalized.length > 0 ? normalized.map((url) => newSocialRow(url)) : [];
}

function safeImageSrc(url: string | null | undefined): string {
  if (!url) return '';
  const s = url.trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://x';
    const parsed = new URL(s, base);
    if (['https:', 'http:', 'blob:'].includes(parsed.protocol.toLowerCase())) return parsed.href;
  } catch {
    // ignore
  }
  return '';
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled,
  });
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
        title="Remove"
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

export interface CastMemberDialogProps {
  open: boolean;
  podcastId: string;
  cast?: CastMember | null;
  isFirstEntry: boolean;
  canAddHost: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CastMemberDialog({
  open,
  podcastId,
  cast,
  isFirstEntry,
  canAddHost,
  onClose,
  onSuccess,
}: CastMemberDialogProps) {
  const isEdit = !!cast;
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<'host' | 'guest'>('guest');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [socialLinkRows, setSocialLinkRows] = useState<SocialLinkRow[]>([]);
  const [email, setEmail] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [isPublic, setIsPublic] = useState(1);
  const [coverMode, setCoverMode] = useState<'url' | 'upload'>('url');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formBaseline, setFormBaseline] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useAutoResizeTextarea(descriptionRef, description, { minHeight: 80 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (open) {
      setError(null);
      const socialLinks = Array.isArray(cast?.socialLinks) ? cast.socialLinks : [];
      const next = cast
        ? {
            name: cast.name,
            nickname: cast.nickname ?? '',
            role: cast.role as 'host' | 'guest',
            description: cast.description ?? '',
            photoUrl: cast.photoUrl ?? '',
            socialLinks,
            email: cast.email ?? '',
            timeZone: cast.timeZone ?? '',
            isPublic: cast.isPublic ?? 1,
            coverMode: (cast.photoFilename ? 'upload' : 'url') as 'url' | 'upload',
          }
        : {
            name: '',
            nickname: '',
            role: (isFirstEntry ? 'host' : 'guest') as 'host' | 'guest',
            description: '',
            photoUrl: '',
            socialLinks: [] as string[],
            email: '',
            timeZone: '',
            isPublic: 1,
            coverMode: 'url' as const,
          };
      setName(next.name);
      setNickname(next.nickname);
      setRole(next.role);
      setDescription(next.description);
      setPhotoUrl(next.photoUrl);
      setSocialLinkRows(rowsFromUrls(next.socialLinks));
      setEmail(next.email);
      setTimeZone(next.timeZone);
      setIsPublic(next.isPublic);
      setCoverMode(next.coverMode);
      setPendingFile(null);
      setFormBaseline(snapshotForDirty(next));
    }
  }, [open, cast, isFirstEntry]);

  useEffect(() => {
    if (!pendingFile) {
      setPendingPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const createMutation = useMutation({
    mutationFn: (body: CastCreate) => createCast(podcastId, body),
    onSuccess: async (data) => {
      if (pendingFile && data.id) {
        try {
          await uploadCastPhoto(podcastId, data.id, pendingFile);
        } catch {
          // Non-fatal; cast was created
        }
      }
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateCast>[2]) =>
      updateCast(podcastId, cast!.id, body),
    onSuccess: async () => {
      if (pendingFile && cast) {
        try {
          await uploadCastPhoto(podcastId, cast.id, pendingFile);
        } catch {
          // Non-fatal
        }
      }
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimName = name.trim();
    if (!trimName) return;
    if (role === 'host' && !canAddHost) {
      setError('Only owners and managers can add hosts.');
      return;
    }
    const socialLinks = normalizeCastSocialLinks(socialLinkRows.map((r) => r.url));
    const body: CastCreate = {
      name: trimName,
      nickname: nickname.trim() || undefined,
      role,
      description: description.trim() || undefined,
      photoUrl: coverMode === 'url' ? (photoUrl.trim() || undefined) : undefined,
      socialLinks,
      email: email.trim() || undefined,
      timeZone: timeZone.trim() || undefined,
      isPublic: isPublic as 0 | 1,
    };
    if (isEdit) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  };

  const photoSrc =
    pendingPreviewUrl ||
    (cast?.photoFilename && podcastId
      ? castPhotoUrl(podcastId, cast.id, cast.photoFilename)
      : '') ||
    safeImageSrc(photoUrl);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const currentForm = useMemo(
    () => ({
      name,
      nickname,
      role,
      description,
      photoUrl,
      socialLinks: normalizeCastSocialLinks(socialLinkRows.map((r) => r.url)),
      email,
      timeZone,
      isPublic,
      coverMode,
    }),
    [name, nickname, role, description, photoUrl, socialLinkRows, email, timeZone, isPublic, coverMode],
  );
  const isDirty = useBaselineDirty(formBaseline, currentForm) || pendingFile != null;
  const {
    confirmOpen,
    requestClose,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
  } = useDialogCloseGuard({ isDirty, onClose });

  const onSocialDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSocialLinkRows((rows) => {
      const oldIndex = rows.findIndex((r) => r.id === active.id);
      const newIndex = rows.findIndex((r) => r.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return rows;
      return arrayMove(rows, oldIndex, newIndex);
    });
  };

  const canAddSocialLink = socialLinkRows.length < CAST_SOCIAL_LINKS_MAX;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable}`}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onPointerDownOutside(e);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            dialogContentProps.onInteractOutside(e);
          }}
          onEscapeKeyDown={dialogContentProps.onEscapeKeyDown}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {isEdit ? 'Edit Cast Member' : 'Add Cast Member'}
            </Dialog.Title>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="Close"
              disabled={isPending}
              onClick={requestClose}
            >
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <Dialog.Description className={styles.dialogDescription}>
            {isEdit ? 'Update the cast member details.' : ''}
          </Dialog.Description>
          <form onSubmit={handleSubmit} className={styles.castDialogFormWrap}>
            <div className={styles.dialogBodyScroll}>
              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Name <span className={styles.castDialogRequired} aria-hidden="true">*</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={styles.castDialogFormInput}
                    placeholder="e.g. Jane Doe"
                    required
                  />
                </label>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Nickname
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className={styles.castDialogFormInput}
                    placeholder="e.g. Jane"
                    autoComplete="off"
                  />
                </label>
                <p className={styles.castDialogHint}>
                  Short name used in multi-speaker transcripts. Falls back to Name when empty.
                </p>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={styles.castDialogFormInput}
                    placeholder="jane@example.com"
                    autoComplete="off"
                  />
                </label>
                <p className={styles.castDialogHint}>
                  Used for meeting invites. Not shown on public pages.
                </p>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Time Zone
                  <select
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    className={styles.castDialogFormInput}
                  >
                    <option value="">Not set</option>
                    {ianaTimeZoneSelectOptions(timeZone).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.castDialogHint}>
                  Used for meeting emails so times show in their local zone. Not shown on public pages.
                </p>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Role
                  <div className={styles.castDialogRoleToggle} role="group" aria-label="Host or Guest">
                    <button
                      type="button"
                      className={role === 'guest' ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                      onClick={() => setRole('guest')}
                      disabled={!canAddHost && role === 'host'}
                      aria-pressed={role === 'guest'}
                    >
                      Guest
                    </button>
                    <button
                      type="button"
                      className={role === 'host' ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                      onClick={() => canAddHost && setRole('host')}
                      disabled={!canAddHost}
                      aria-pressed={role === 'host'}
                    >
                      Host
                    </button>
                  </div>
                </label>
              </div>

              <div className={`${styles.castDialogFormGroup} ${styles.castDialogFormGroupDescription}`}>
                <label className={styles.castDialogFormLabel}>
                  Description
                  <textarea
                    ref={descriptionRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={styles.castDialogFormTextarea}
                    rows={2}
                    placeholder="Short bio or title"
                    style={{ overflow: 'hidden', resize: 'none', minHeight: 80 }}
                  />
                </label>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Photo
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.375rem' }}>
                    {photoSrc ? (
                      <img src={photoSrc} alt={`${name || 'Cast member'} photo`} className={styles.castPhotoPreview} />
                    ) : (
                      <div className={styles.castPhotoPreviewPlaceholder}>
                        <User size={24} aria-hidden />
                      </div>
                    )}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
                      <div className={styles.castDialogRoleToggle} role="group">
                        <button
                          type="button"
                          className={coverMode === 'url' ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                          onClick={() => setCoverMode('url')}
                          aria-pressed={coverMode === 'url'}
                        >
                          URL
                        </button>
                        <button
                          type="button"
                          className={coverMode === 'upload' ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                          onClick={() => setCoverMode('upload')}
                          aria-pressed={coverMode === 'upload'}
                        >
                          Upload
                        </button>
                      </div>
                      {coverMode === 'url' ? (
                        <input
                          type="url"
                          value={photoUrl}
                          onChange={(e) => setPhotoUrl(e.target.value)}
                          className={styles.castDialogFormInput}
                          placeholder="https://..."
                        />
                      ) : (
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                          className={styles.castDialogFileInput}
                        />
                      )}
                    </div>
                  </div>
                </label>
              </div>

              <div className={styles.castDialogFormGroup}>
                <div className={styles.castDialogFormLabel}>Social links</div>
                <p className={styles.castDialogHint}>
                  First link is used for RSS and as the primary theme URL. Drag to reorder.
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onSocialDragEnd}
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
                          disabled={isPending}
                          onChange={(id, url) =>
                            setSocialLinkRows((rows) =>
                              rows.map((r) => (r.id === id ? { ...r, url } : r)),
                            )
                          }
                          onRemove={(id) =>
                            setSocialLinkRows((rows) => rows.filter((r) => r.id !== id))
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  type="button"
                  className={styles.castSocialLinkAdd}
                  onClick={() => setSocialLinkRows((rows) => [...rows, newSocialRow()])}
                  disabled={isPending || !canAddSocialLink}
                >
                  <Plus size={16} strokeWidth={2.25} aria-hidden />
                  Add Link
                </button>
              </div>

              <div className={styles.castDialogFormGroup}>
                <label className={styles.castDialogFormLabel}>
                  Visibility
                  <div className={styles.castDialogRoleToggle} role="group">
                    <button
                      type="button"
                      className={isPublic === 1 ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                      onClick={() => setIsPublic(1)}
                      aria-pressed={isPublic === 1}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      className={isPublic === 0 ? styles.castDialogRoleToggleBtnActive : styles.castDialogRoleToggleBtn}
                      onClick={() => setIsPublic(0)}
                      aria-pressed={isPublic === 0}
                    >
                      Private
                    </button>
                  </div>
                </label>
              </div>
            </div>

            <div className={styles.castDialogActions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={requestClose}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.dialogConfirm}
                disabled={isPending}
              >
                {isPending ? 'Saving...' : isEdit ? 'Save' : 'Add'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </Dialog.Root>
  );
}
