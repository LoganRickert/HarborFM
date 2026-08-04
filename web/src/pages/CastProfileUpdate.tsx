import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  CAST_SOCIAL_LINKS_MAX,
  normalizeCastSocialLinks,
} from '@harborfm/shared';
import {
  getCastProfileUpdateForm,
  submitCastProfileUpdate,
} from '../api/castProfileUpdate';
import { resizeCastProfilePhoto } from '../utils/resizeCastProfilePhoto';
import { ianaTimeZoneSelectOptions } from '../utils/ianaTimeZones';
import authStyles from './Auth.module.css';
import castStyles from '../components/ShowCast/ShowCast.module.css';
import styles from './CastProfileUpdate.module.css';

type SocialLinkRow = { id: string; url: string };

function newSocialRow(url = ''): SocialLinkRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    url,
  };
}

function rowsFromUrls(urls: string[]): SocialLinkRow[] {
  const normalized = normalizeCastSocialLinks(urls);
  if (normalized.length === 0) return [];
  return normalized.map((url) => newSocialRow(url));
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
    <div ref={setNodeRef} style={style} className={castStyles.castSocialLinkRow}>
      <button
        type="button"
        className={castStyles.castSocialLinkDrag}
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
        className={styles.input}
        placeholder="https://instagram.com/username"
        disabled={disabled}
        aria-label={`Social link ${index + 1}`}
      />
      <button
        type="button"
        className={castStyles.castSocialLinkRemove}
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

export function CastProfileUpdate() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();
  const formId = useId();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cast-profile-update', token],
    queryFn: () => getCastProfileUpdateForm(token),
    enabled: !!token,
    retry: false,
  });

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [description, setDescription] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [socialLinkRows, setSocialLinkRows] = useState<SocialLinkRow[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data || data.state !== 'ok' || hydrated) return;
    setName(data.name || '');
    setNickname(data.nickname || '');
    setDescription(data.description || '');
    setTimeZone(data.timeZone || '');
    setSocialLinkRows(rowsFromUrls(data.socialLinks || []));
    setPhotoPreview(data.photoUrl || null);
    setHydrated(true);
  }, [data, hydrated]);

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

  const mutation = useMutation({
    mutationFn: async () => {
      const socialLinks = normalizeCastSocialLinks(
        socialLinkRows.map((r) => r.url),
      );
      let photo: File | null = photoFile;
      if (photo) {
        photo = await resizeCastProfilePhoto(photo);
      }
      return submitCastProfileUpdate({
        token,
        name: name.trim(),
        nickname: nickname.trim(),
        description: description.trim(),
        socialLinks,
        timeZone: timeZone.trim() || null,
        photo,
      });
    },
    onSuccess: () => {
      setFormError(null);
      setSubmitted(true);
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const canAddSocialLink = socialLinkRows.length < CAST_SOCIAL_LINKS_MAX;

  const invalid =
    !token ||
    isError ||
    (data != null && data.state === 'invalid');

  const invalidMessage = useMemo(() => {
    if (!token) return 'This update link is missing a token.';
    if (isError) {
      return error instanceof Error
        ? error.message
        : 'This update link is invalid or has expired.';
    }
    return 'This update link is invalid or has expired.';
  }, [token, isError, error]);

  if (isLoading && token) {
    return (
      <main>
        <div className={authStyles.wrap}>
          <div className={authStyles.card}>
            <div className={authStyles.brand}>
              <img src="/favicon.svg" alt="" className={authStyles.brandIcon} />
              <h1 className={authStyles.title}>HarborFM</h1>
            </div>
            <p className={styles.lead}>Loading your profile form...</p>
          </div>
        </div>
      </main>
    );
  }

  if (invalid) {
    return (
      <main>
        <div className={authStyles.wrap}>
          <div className={authStyles.card}>
            <div className={authStyles.brand}>
              <img src="/favicon.svg" alt="" className={authStyles.brandIcon} />
              <h1 className={authStyles.title}>HarborFM</h1>
            </div>
            <h2 className={styles.heading}>Link Unavailable</h2>
            <p className={styles.lead}>{invalidMessage}</p>
            <p className={styles.hint}>
              Ask the show team to send a new Update email if you still need to
              change your profile.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main>
        <div className={authStyles.wrap}>
          <div className={authStyles.card}>
            <div className={authStyles.brand}>
              <img src="/favicon.svg" alt="" className={authStyles.brandIcon} />
              <h1 className={authStyles.title}>HarborFM</h1>
            </div>
            <h2 className={styles.heading}>Thanks for Updating</h2>
            <p className={styles.lead}>
              The show team has been notified. You will get an email when your
              profile update is approved.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const podcastTitle =
    data && data.state === 'ok' ? data.podcastTitle : 'your show';

  return (
    <main>
      <div className={authStyles.wrap}>
        <div className={`${authStyles.card} ${styles.formCard}`}>
          <div className={authStyles.brand}>
            <img src="/favicon.svg" alt="" className={authStyles.brandIcon} />
            <h1 className={authStyles.title}>HarborFM</h1>
          </div>
          <h2 className={styles.heading}>Update Your Cast Profile</h2>
          <p className={styles.lead}>
            Edit your details for {podcastTitle}. Changes go to the show team
            for approval.
          </p>

          <form
            id={formId}
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              if (!name.trim()) {
                setFormError('Preferred Name is required');
                return;
              }
              mutation.mutate();
            }}
          >
            <label className={styles.label}>
              Preferred Name
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={mutation.isPending}
                autoComplete="name"
              />
            </label>
            <label className={styles.label}>
              Nickname
              <input
                className={styles.input}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                disabled={mutation.isPending}
                placeholder="Optional short label"
              />
            </label>
            <label className={styles.label}>
              Description
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={mutation.isPending}
                rows={4}
              />
            </label>

            <label className={styles.label}>
              Time Zone
              <select
                className={styles.input}
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                disabled={mutation.isPending}
              >
                <option value="">Not set</option>
                {ianaTimeZoneSelectOptions(timeZone).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.hint}>
              Used for meeting emails so times show in your local zone. Not shown
              on public pages.
            </p>

            <div className={styles.photoBlock}>
              <span className={styles.labelText}>Photo</span>
              <div className={styles.photoRow}>
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt=""
                    className={styles.photoPreview}
                  />
                ) : (
                  <div className={styles.photoPlaceholder}>No Photo Yet</div>
                )}
                <div className={styles.photoControls}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className={styles.fileInputHidden}
                    disabled={mutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setPhotoFile(file);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.choosePhotoBtn}
                    disabled={mutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose Photo
                  </button>
                  {photoFile ? (
                    <span className={styles.photoFileName}>{photoFile.name}</span>
                  ) : (
                    <span className={styles.photoFileNameMuted}>No file selected</span>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.socialBlock}>
              <span className={styles.labelText}>Social links</span>
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
                  <div className={castStyles.castSocialLinkList}>
                    {socialLinkRows.map((row, index) => (
                      <SortableSocialLinkRow
                        key={row.id}
                        row={row}
                        index={index}
                        disabled={mutation.isPending}
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
                className={castStyles.castSocialLinkAdd}
                onClick={() =>
                  setSocialLinkRows((rows) => [...rows, newSocialRow()])
                }
                disabled={mutation.isPending || !canAddSocialLink}
              >
                <Plus size={16} aria-hidden />
                Add Link
              </button>
            </div>

            {formError ? (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              className={styles.submit}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Submitting...' : 'Submit for Approval'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
