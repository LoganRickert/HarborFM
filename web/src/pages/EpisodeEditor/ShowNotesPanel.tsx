import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { ShowNotesDurationMin, ShowNotesItem } from '@harborfm/shared';
import { SHOW_NOTES_DURATION_OPTIONS, SHOW_NOTES_TAG_LABELS } from '@harborfm/shared';
import {
  addShowNotesItemToNotes,
  createShowNotesItem,
  deleteShowNotesItem,
  getShowNotes,
  patchShowNotesSettings,
  reorderShowNotesItems,
  showNotesQueryKey,
  updateShowNotesItem,
} from '../../api/showNotes';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';
import { DeleteShowNotesItemDialog } from './DeleteShowNotesItemDialog';
import styles from '../EpisodeEditor.module.css';

const DURATION_OPTIONS = SHOW_NOTES_DURATION_OPTIONS;

export interface ShowNotesPanelProps {
  episodeId: string;
  canEdit: boolean;
}

function SortableShowNotesRow({
  item,
  canEdit,
  onToggleChecked,
  onDurationChange,
  onTextChange,
  onDelete,
}: {
  item: ShowNotesItem;
  canEdit: boolean;
  onToggleChecked: (id: string, checked: boolean) => void;
  onDurationChange: (id: string, durationMin: ShowNotesDurationMin | null) => void;
  onTextChange: (id: string, text: string) => void;
  onDelete: (item: ShowNotesItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = useState(item.text);
  useEffect(() => {
    setLocalText(item.text);
  }, [item.text]);
  useAutoResizeTextarea(textareaRef, localText, { minHeight: 36 });

  const debouncedText = useDebouncedCallback((id: string, text: string) => {
    onTextChange(id, text);
  }, 400);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
  };

  const durationLabelId = `show-notes-duration-${item.id}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.showNotesItem} ${item.checked ? styles.showNotesItemChecked : ''}`}
    >
      {canEdit && (
        <div className={styles.showNotesItemToolbar}>
          <button
            type="button"
            className={styles.showNotesDragHandle}
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.showNotesDeleteBtn}
            onClick={() => onDelete(item)}
            aria-label="Remove topic"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className={styles.showNotesTextarea}
        value={localText}
        disabled={!canEdit}
        placeholder="Topic to discuss..."
        maxLength={500}
        rows={1}
        onChange={(e) => {
          const v = e.target.value;
          setLocalText(v);
          debouncedText(item.id, v);
        }}
        onBlur={() => {
          if (localText !== item.text) onTextChange(item.id, localText);
        }}
      />

      <div className={styles.showNotesDurationWrap}>
        <span className={styles.showNotesDurationLabel} id={durationLabelId}>
          Duration
        </span>
        <div
          className={styles.showNotesDurationRow}
          role="group"
          aria-labelledby={durationLabelId}
        >
          {DURATION_OPTIONS.map((min) => (
            <button
              key={min}
              type="button"
              className={`${styles.showNotesDurationChip} ${item.durationMin === min ? styles.showNotesDurationChipActive : ''}`}
              disabled={!canEdit}
              onClick={() =>
                onDurationChange(item.id, item.durationMin === min ? null : min)
              }
              aria-pressed={item.durationMin === min}
            >
              {min}m
            </button>
          ))}
        </div>
      </div>

      <label className={styles.showNotesDiscussedLabel}>
        <input
          type="checkbox"
          className={styles.showNotesCheckbox}
          checked={item.checked}
          disabled={!canEdit}
          onChange={(e) => onToggleChecked(item.id, e.target.checked)}
        />
        <span>Discussed</span>
      </label>
    </li>
  );
}

export function ShowNotesPanel({ episodeId, canEdit }: ShowNotesPanelProps) {
  const queryClient = useQueryClient();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ShowNotesItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: showNotesQueryKey(episodeId),
    queryFn: () => getShowNotes(episodeId),
  });

  const items = data?.items;
  const guestVisible = data?.guestVisible ?? true;
  const noteItems = useMemo(
    () => (items ?? []).filter((i) => i.tag === 'none'),
    [items],
  );
  const submittedItems = useMemo(
    () => (items ?? []).filter((i) => i.tag === 'discuss' || i.tag === 'avoid'),
    [items],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: showNotesQueryKey(episodeId) });
  }, [queryClient, episodeId]);

  const guestVisibleMutation = useMutation({
    mutationFn: (visible: boolean) => patchShowNotesSettings(episodeId, { guestVisible: visible }),
    onSuccess: invalidate,
  });

  const createMutation = useMutation({
    mutationFn: () => createShowNotesItem(episodeId, { text: '', tag: 'none' }),
    onSuccess: invalidate,
  });

  const addToNotesMutation = useMutation({
    mutationFn: (itemId: string) => addShowNotesItemToNotes(episodeId, itemId),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string;
      body: Parameters<typeof updateShowNotesItem>[2];
    }) => updateShowNotesItem(episodeId, itemId, body),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (itemIds: string[]) => reorderShowNotesItems(episodeId, itemIds),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteShowNotesItem(episodeId, itemId),
    onSuccess: invalidate,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = noteItems.findIndex((i) => i.id === active.id);
    const newIndex = noteItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextNotes = arrayMove(noteItems, oldIndex, newIndex);
    const nextAll = [
      ...nextNotes,
      ...(items ?? []).filter((i) => i.tag !== 'none'),
    ].map((item, position) => ({ ...item, position }));
    queryClient.setQueryData(showNotesQueryKey(episodeId), {
      guestVisible,
      items: nextAll,
    });
    reorderMutation.mutate(nextNotes.map((i) => i.id));
  };

  if (isLoading && !data) {
    return null;
  }

  return (
    <div className={styles.card}>
      <div className={styles.showNotesPanel}>
        <div className={styles.showNotesHeader}>
          <div className={styles.showNotesHeaderText}>
            <h2 className={styles.sectionTitle}>Show Notes</h2>
          </div>
          <button
            type="button"
            className={styles.showNotesHeaderToggle}
            onClick={() => setBodyExpanded((prev) => !prev)}
            aria-expanded={bodyExpanded}
            aria-controls="show-notes-body"
            aria-label={bodyExpanded ? 'Hide show notes' : 'Show show notes'}
          >
            {bodyExpanded ? (
              <ChevronUp size={18} strokeWidth={2} aria-hidden />
            ) : (
              <ChevronDown size={18} strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>

        <div
          id="show-notes-body"
          className={styles.showNotesBody}
          hidden={!bodyExpanded}
        >
        {canEdit && (
          <div className={styles.showNotesGuestVisibility}>
            <div className={styles.showNotesGuestVisibilityCopy}>
              <span className={styles.showNotesGuestVisibilityTitle}>Guest visibility</span>
            </div>
            <div
              className={styles.showNotesGuestVisibilityControl}
              role="group"
              aria-label="Show notes guest visibility"
            >
              <button
                type="button"
                className={`${styles.showNotesGuestVisibilityBtn} ${!guestVisible ? styles.showNotesGuestVisibilityBtnActive : ''}`}
                aria-pressed={!guestVisible}
                disabled={guestVisibleMutation.isPending}
                onClick={() => guestVisibleMutation.mutate(false)}
              >
                Host only
              </button>
              <button
                type="button"
                className={`${styles.showNotesGuestVisibilityBtn} ${guestVisible ? styles.showNotesGuestVisibilityBtnActive : ''}`}
                aria-pressed={guestVisible}
                disabled={guestVisibleMutation.isPending}
                onClick={() => guestVisibleMutation.mutate(true)}
              >
                Share with guests
              </button>
            </div>
          </div>
        )}

        <h3 className={styles.showNotesSectionHeading}>Notes</h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={noteItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className={styles.showNotesList}>
              {noteItems.map((item) => (
                <SortableShowNotesRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onToggleChecked={(id, checked) =>
                    updateMutation.mutate({ itemId: id, body: { checked } })
                  }
                  onDurationChange={(id, durationMin) =>
                    updateMutation.mutate({ itemId: id, body: { durationMin } })
                  }
                  onTextChange={(id, text) =>
                    updateMutation.mutate({ itemId: id, body: { text } })
                  }
                  onDelete={setDeleteTarget}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {canEdit && (
          <button
            type="button"
            className={styles.showNotesAddTopicBtn}
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            <Plus size={16} aria-hidden />
            Add Topic
          </button>
        )}

        <h3 className={styles.showNotesSectionHeading}>Submitted Topics</h3>
        {submittedItems.length === 0 ? (
          <p className={styles.showNotesSubmittedEmpty}>
            Guests can suggest topics to discuss or avoid from their meeting invite or join link.
          </p>
        ) : (
          <ul className={styles.showNotesSubmittedList}>
            {submittedItems.map((item) => (
              <li key={item.id} className={styles.showNotesSubmittedItem}>
                <div className={styles.showNotesSubmittedMeta}>
                  <span
                    className={`${styles.showNotesSubmittedTag} ${
                      item.tag === 'avoid' ? styles.showNotesSubmittedTagAvoid : ''
                    }`}
                  >
                    {SHOW_NOTES_TAG_LABELS[item.tag]}
                  </span>
                  <span className={styles.showNotesSubmittedBy}>
                    Submitted by {item.submittedBy?.trim() || 'Unknown'}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className={styles.showNotesDeleteBtn}
                      onClick={() => setDeleteTarget(item)}
                      aria-label="Remove submitted topic"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
                <p className={styles.showNotesSubmittedText}>
                  {item.text.trim() || '(empty)'}
                </p>
                {canEdit && item.tag === 'discuss' && (
                  <button
                    type="button"
                    className={styles.showNotesQuickAddBtn}
                    disabled={addToNotesMutation.isPending}
                    onClick={() => addToNotesMutation.mutate(item.id)}
                  >
                    <Plus size={14} aria-hidden />
                    Add To Notes
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>

      <DeleteShowNotesItemDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        description={
          deleteTarget?.text.trim()
            ? `"${deleteTarget.text.trim().slice(0, 80)}${deleteTarget.text.length > 80 ? '...' : ''}" will be removed.`
            : 'This topic will be removed.'
        }
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
