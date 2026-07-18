import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { CircleAlert, ExternalLink, FileUp, GripVertical, Link2, Trash2, X } from 'lucide-react';
import type { EpisodeFileItem } from '@harborfm/shared';
import {
  createEpisodeFileLink,
  deleteEpisodeFile,
  episodeFilesQueryKey,
  getEpisodeFiles,
  reorderEpisodeFiles,
  updateEpisodeFile,
  uploadEpisodeFile,
} from '../../api/episodeFiles';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { DeleteShowNotesItemDialog } from './DeleteShowNotesItemDialog';
import styles from './EpisodeFilesDialog.module.css';

const EPISODE_FILE_MAX_BYTES = 50 * 1024 * 1024;
const EPISODE_FILE_ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'zip',
  'txt',
  'csv',
  'md',
]);
const EPISODE_FILE_UNSUPPORTED_TYPE_MESSAGE =
  'Unsupported file type. Allowed: jpg, png, gif, webp, heic, pdf, docx, xlsx, pptx, zip, txt, csv, md';

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionFromFilename(filename: string): string | null {
  const base = filename.trim().split(/[/\\]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}

function validateEpisodeUpload(file: File): string | null {
  const ext = extensionFromFilename(file.name);
  if (!ext || !EPISODE_FILE_ALLOWED_EXTENSIONS.has(ext)) {
    return EPISODE_FILE_UNSUPPORTED_TYPE_MESSAGE;
  }
  if (file.size > EPISODE_FILE_MAX_BYTES) {
    return 'File too large (max 50MB)';
  }
  return null;
}

function fileExtensionLabel(item: EpisodeFileItem): string | null {
  if (item.kind !== 'file') return null;
  const fromName = extensionFromFilename(item.originalFilename ?? '');
  if (fromName) return fromName.toUpperCase();
  const mime = item.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return mime.slice('image/'.length).toUpperCase();
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime.includes('spreadsheetml')) return 'XLSX';
  if (mime.includes('presentationml')) return 'PPTX';
  if (mime === 'application/zip') return 'ZIP';
  if (mime === 'text/plain') return 'TXT';
  if (mime === 'text/csv') return 'CSV';
  if (mime === 'text/markdown') return 'MD';
  return null;
}

function itemOpenHref(item: EpisodeFileItem): string | null {
  if (item.kind === 'link') return item.url?.trim() || null;
  return item.downloadUrl?.trim() || null;
}

function SortableFileRow({
  item,
  canEdit,
  onSaveMeta,
  onDelete,
}: {
  item: EpisodeFileItem;
  canEdit: boolean;
  onSaveMeta: (id: string, patch: { title: string; description: string; url?: string }) => void;
  onDelete: (item: EpisodeFileItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [url, setUrl] = useState(item.url ?? '');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(descriptionRef, description, { minHeight: 40 });
  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description ?? '');
    setUrl(item.url ?? '');
  }, [item.title, item.description, item.url]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
  };
  const extLabel = fileExtensionLabel(item);
  const openHref =
    item.kind === 'link'
      ? url.trim() || null
      : itemOpenHref(item);

  function saveIfChanged() {
    if (!canEdit || !title.trim()) return;
    const nextDescription = description;
    const prevDescription = item.description ?? '';
    const titleChanged = title.trim() !== item.title;
    const descriptionChanged = nextDescription !== prevDescription;
    if (item.kind === 'link') {
      const nextUrl = url.trim();
      if (!nextUrl) return;
      const urlChanged = nextUrl !== (item.url ?? '');
      if (!titleChanged && !descriptionChanged && !urlChanged) return;
      onSaveMeta(item.id, {
        title: title.trim(),
        description: nextDescription,
        url: nextUrl,
      });
      return;
    }
    if (!titleChanged && !descriptionChanged) return;
    onSaveMeta(item.id, {
      title: title.trim(),
      description: nextDescription,
    });
  }

  return (
    <li ref={setNodeRef} style={style} className={styles.item}>
      <div className={styles.itemTop}>
        {canEdit && (
          <button
            type="button"
            className={styles.grip}
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
        )}
        <div className={styles.itemMeta}>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>{item.kind === 'link' ? 'Link' : 'File'}</span>
            {extLabel && <span className={styles.extBadge}>{extLabel}</span>}
          </div>
          <input
            className={styles.input}
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveIfChanged}
            aria-label="Title"
          />
          {item.kind === 'link' && (
            <input
              className={styles.input}
              type="url"
              value={url}
              disabled={!canEdit}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={saveIfChanged}
              placeholder="https://…"
              aria-label="URL"
            />
          )}
          <textarea
            ref={descriptionRef}
            className={styles.textarea}
            value={description}
            disabled={!canEdit}
            rows={1}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveIfChanged}
            placeholder="Description (optional)"
            aria-label="Description"
          />
          <div className={styles.itemFooter}>
            {openHref && (
              <a
                className={styles.openLink}
                href={openHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
            {item.kind === 'file' && (
              <p className={styles.sizeOrUrl}>{formatBytes(item.byteSize)}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onDelete(item)}
            aria-label="Delete"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

export interface EpisodeFilesDialogProps {
  episodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

export function EpisodeFilesDialog({
  episodeId,
  open,
  onOpenChange,
  readOnly = false,
}: EpisodeFilesDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<'upload' | 'link'>('upload');
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const linkDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<EpisodeFileItem | null>(null);
  useAutoResizeTextarea(linkDescriptionRef, linkDescription, { minHeight: 40 });

  const { data, isLoading } = useQuery({
    queryKey: episodeFilesQueryKey(episodeId),
    queryFn: () => getEpisodeFiles(episodeId),
    enabled: open && !!episodeId,
  });
  const items = data?.items ?? [];

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: episodeFilesQueryKey(episodeId) });
  }, [episodeId, queryClient]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadEpisodeFile(episodeId, file, {
        title: file.name.replace(/\.[^.]+$/, ''),
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const linkMutation = useMutation({
    mutationFn: () =>
      createEpisodeFileLink(episodeId, {
        url: linkUrl.trim(),
        title: linkTitle.trim() || linkUrl.trim(),
        description: linkDescription.trim() || null,
      }),
    onSuccess: () => {
      setLinkUrl('');
      setLinkTitle('');
      setLinkDescription('');
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      title,
      description,
      url,
    }: {
      id: string;
      title: string;
      description: string;
      url?: string;
    }) =>
      updateEpisodeFile(episodeId, id, {
        title,
        description: description.trim() ? description : null,
        ...(url !== undefined ? { url } : {}),
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (itemIds: string[]) => reorderEpisodeFiles(episodeId, itemIds),
    onSuccess: (res) => {
      queryClient.setQueryData(episodeFilesQueryKey(episodeId), res);
    },
    onError: (err: Error) => {
      setError(err.message);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => deleteEpisodeFile(episodeId, fileId),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || readOnly) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    queryClient.setQueryData(episodeFilesQueryKey(episodeId), { items: next });
    reorderMutation.mutate(next.map((i) => i.id));
  }

  function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || readOnly) return;
    const files = Array.from(fileList);
    for (const file of files) {
      const validationError = validateEpisodeUpload(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      uploadMutation.mutate(file);
    }
  }

  const canEdit = !readOnly;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.content} aria-describedby="episode-files-desc">
            <div className={styles.header}>
              <div>
                <Dialog.Title className={styles.title}>Episode Files</Dialog.Title>
                <Dialog.Description id="episode-files-desc" className={styles.description}>
                  Attach files and links for listeners. Shown on the public episode page.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className={styles.close} aria-label="Close">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.body}>
              {error && (
                <div className={styles.errorCard} role="alert">
                  <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                  <p className={styles.errorCardMessage}>{error}</p>
                </div>
              )}

              {canEdit && (
                <>
                  <div className={styles.segmented} role="group" aria-label="Add episode file">
                    <button
                      type="button"
                      className={addMode === 'upload' ? styles.segmentedActive : styles.segmentedBtn}
                      aria-pressed={addMode === 'upload'}
                      onClick={() => {
                        setAddMode('upload');
                        dragDepthRef.current = 0;
                        setDropActive(false);
                        setError(null);
                      }}
                    >
                      <FileUp size={14} aria-hidden />
                      Upload
                    </button>
                    <button
                      type="button"
                      className={addMode === 'link' ? styles.segmentedActive : styles.segmentedBtn}
                      aria-pressed={addMode === 'link'}
                      onClick={() => {
                        setAddMode('link');
                        dragDepthRef.current = 0;
                        setDropActive(false);
                        setError(null);
                      }}
                    >
                      <Link2 size={14} aria-hidden />
                      Link
                    </button>
                  </div>

                  {addMode === 'upload' ? (
                    <div
                      className={`${styles.dropZone} ${dropActive ? styles.dropZoneActive : ''}`}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragDepthRef.current += 1;
                        setDropActive(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                        if (dragDepthRef.current === 0) setDropActive(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragDepthRef.current = 0;
                        setDropActive(false);
                        handleFiles(e.dataTransfer.files);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                    >
                      <FileUp size={22} aria-hidden />
                      <p className={styles.dropZoneText}>
                        {uploadMutation.isPending ? 'Uploading…' : 'Drop files here or click to upload'}
                      </p>
                      <p className={styles.dropZoneHint}>
                        jpg, png, gif, webp, heic, pdf, docx, xlsx, pptx, zip, txt, csv, md (max 50MB)
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className={styles.fileInput}
                        multiple
                        onChange={(e) => {
                          handleFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  ) : (
                    <form
                      className={styles.linkForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!linkUrl.trim()) return;
                        linkMutation.mutate();
                      }}
                    >
                      <input
                        className={styles.input}
                        type="url"
                        placeholder="https://…"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        required
                      />
                      <input
                        className={styles.input}
                        type="text"
                        placeholder="Title"
                        value={linkTitle}
                        onChange={(e) => setLinkTitle(e.target.value)}
                      />
                      <textarea
                        ref={linkDescriptionRef}
                        className={styles.textarea}
                        placeholder="Description (optional)"
                        value={linkDescription}
                        rows={1}
                        onChange={(e) => setLinkDescription(e.target.value)}
                      />
                      <div className={styles.rowActions}>
                        <button
                          type="submit"
                          className={styles.primaryBtn}
                          disabled={linkMutation.isPending || !linkUrl.trim()}
                        >
                          {linkMutation.isPending ? 'Adding…' : 'Add link'}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              {isLoading ? (
                <p className={styles.empty}>Loading…</p>
              ) : items.length === 0 ? (
                <p className={styles.empty}>No episode files yet.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    <ul className={styles.list}>
                      {items.map((item) => (
                        <SortableFileRow
                          key={item.id}
                          item={item}
                          canEdit={canEdit}
                          onSaveMeta={(id, patch) =>
                            updateMutation.mutate({ id, ...patch })
                          }
                          onDelete={setDeleteTarget}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <DeleteShowNotesItemDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Remove episode file?"
        description={
          deleteTarget
            ? `Remove “${deleteTarget.title}” from Episode Files? Uploaded files free storage when deleted.`
            : ''
        }
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        isDeleting={deleteMutation.isPending}
      />
    </>
  );
}
