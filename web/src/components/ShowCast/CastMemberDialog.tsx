import { useState, useEffect, useRef } from 'react';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { useMutation } from '@tanstack/react-query';
import { X, User } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  createCast,
  updateCast,
  uploadCastPhoto,
  castPhotoUrl,
  type CastMember,
} from '../../api/podcasts';
import type { CastCreate } from '@harborfm/shared';
import sharedStyles from '../PodcastDetail/shared.module.css';
import localStyles from './ShowCast.module.css';

const styles = { ...sharedStyles, ...localStyles };

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
  const [role, setRole] = useState<'host' | 'guest'>('guest');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [socialLinkText, setSocialLinkText] = useState('');
  const [isPublic, setIsPublic] = useState(1);
  const [coverMode, setCoverMode] = useState<'url' | 'upload'>('url');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useAutoResizeTextarea(descriptionRef, description, { minHeight: 80 });

  useEffect(() => {
    if (open) {
      setError(null);
      if (cast) {
        setName(cast.name);
        setRole(cast.role as 'host' | 'guest');
        setDescription(cast.description ?? '');
        setPhotoUrl(cast.photo_url ?? '');
        setSocialLinkText(cast.social_link_text ?? '');
        setIsPublic(cast.is_public ?? 1);
        setCoverMode(cast.photo_filename ? 'upload' : 'url');
        setPendingFile(null);
      } else {
        setName('');
        setRole(isFirstEntry ? 'host' : 'guest');
        setDescription('');
        setPhotoUrl('');
        setSocialLinkText('');
        setIsPublic(1);
        setCoverMode('url');
        setPendingFile(null);
      }
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
    const body: CastCreate = {
      name: trimName,
      role,
      description: description.trim() || undefined,
      photo_url: coverMode === 'url' ? (photoUrl.trim() || undefined) : undefined,
      social_link_text: socialLinkText.trim() || undefined,
      is_public: isPublic as 0 | 1,
    };
    if (isEdit) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  };

  const photoSrc =
    pendingPreviewUrl ||
    (cast?.photo_filename && podcastId
      ? castPhotoUrl(podcastId, cast.id, cast.photo_filename)
      : '') ||
    safeImageSrc(photoUrl);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogContentScrollable}`}
        >
          <div className={styles.dialogHeaderRow}>
            <Dialog.Title className={styles.dialogTitle}>
              {isEdit ? 'Edit cast member' : 'Add cast member'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={isPending}
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
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
                      <img src={photoSrc} alt="" className={styles.castPhotoPreview} />
                    ) : (
                      <div className={styles.castPhotoPreviewPlaceholder}>
                        <User size={24} />
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
                <label className={styles.castDialogFormLabel}>
                  Social Link
                  <input
                    type="url"
                    value={socialLinkText}
                    onChange={(e) => setSocialLinkText(e.target.value)}
                    className={styles.castDialogFormInput}
                    placeholder="e.g. https://instagram.com/username"
                  />
                </label>
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
                onClick={onClose}
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
    </Dialog.Root>
  );
}
