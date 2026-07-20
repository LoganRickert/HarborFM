import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import {
  createThemeFile,
  deleteThemeFile,
  getTheme,
  getThemeFileText,
  patchTheme,
  putThemeFileText,
  setThemeScope,
  themeAssetPreviewUrl,
  uploadThemeFile,
  type ThemeDetail,
} from '../api/themes';
import { UnsavedChangesConfirmDialog } from './UnsavedChangesConfirmDialog';
import { useDialogCloseGuard } from '../hooks/useDialogCloseGuard';
import styles from './ThemeEditorDialog.module.css';

const REQUIRED_FILES = new Set([
  'theme.json',
  'templates/podcast.liquid',
  'templates/episode.liquid',
]);

export type ThemeEditorDialogProps = {
  open: boolean;
  themeId: string | null;
  isAdmin: boolean;
  onClose: () => void;
  /** Called when the edited theme id changes (promote/demote). */
  onThemeIdChange?: (nextId: string) => void;
};

type PageRow = { id: string; template: string; publicPath: string };
type MetadataSaveTarget = 'details' | 'routing';

function newPageRowId(): string {
  return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pagesToRows(pages: Record<string, string>): PageRow[] {
  return Object.entries(pages)
    .map(([template, publicPath]) => ({
      id: newPageRowId(),
      template,
      publicPath,
    }))
    .sort((a, b) => a.template.localeCompare(b.template));
}

function rowsToPages(rows: PageRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const template = row.template.trim();
    const publicPath = row.publicPath.trim();
    if (!template || !publicPath) continue;
    out[template] = publicPath;
  }
  return canonicalPages(out);
}

function canonicalPages(pages: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pages)
      .map(([template, publicPath]) => [template.trim(), publicPath.trim()] as const)
      .filter(([template, publicPath]) => !!template && !!publicPath)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function metadataSnapshot(
  name: string,
  version: string,
  index: string,
  pages: Record<string, string>,
): string {
  return JSON.stringify({
    name: name.trim(),
    version: version.trim(),
    index: index.trim(),
    pages: canonicalPages(pages),
  });
}

function isPageableTemplate(basename: string, indexTemplate: string): boolean {
  if (!basename || basename.startsWith('_')) return false;
  if (basename === 'episode') return false;
  if (basename === indexTemplate) return false;
  return true;
}

export function ThemeEditorDialog({
  open,
  themeId,
  isAdmin,
  onClose,
  onThemeIdChange,
}: ThemeEditorDialogProps) {
  const queryClient = useQueryClient();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [indexTemplate, setIndexTemplate] = useState('podcast');
  const [pageRows, setPageRows] = useState<PageRow[]>([]);
  const [metaBaseline, setMetaBaseline] = useState('');

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileBaseline, setFileBaseline] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<{
    target: MetadataSaveTarget;
    message: string;
  } | null>(null);

  const [addKind, setAddKind] = useState<'template' | 'css' | null>(null);
  const [addName, setAddName] = useState('');

  const [scopeConfirm, setScopeConfirm] = useState<'server' | 'user' | null>(null);
  const [deleteFilePath, setDeleteFilePath] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['theme', themeId],
    queryFn: () => getTheme(themeId!),
    enabled: open && !!themeId,
  });

  useEffect(() => {
    if (!data || !open) return;
    setName(data.name);
    setVersion(data.version);
    setIndexTemplate(data.index || 'podcast');
    setPageRows(pagesToRows(data.pages ?? {}));
    setMetaBaseline(
      metadataSnapshot(data.name, data.version, data.index || 'podcast', data.pages ?? {}),
    );
    setError(null);
    setMetadataError(null);
    setFileError(null);
    setSelectedPath(null);
    setFileContent('');
    setFileBaseline('');
    setAddKind(null);
    setAddName('');
  }, [data, open]);

  const metaDirty = useMemo(() => {
    const current = metadataSnapshot(name, version, indexTemplate, rowsToPages(pageRows));
    return !!metaBaseline && current !== metaBaseline;
  }, [name, version, indexTemplate, pageRows, metaBaseline]);

  const fileDirty = selectedPath != null && fileContent !== fileBaseline;
  const isDirty = metaDirty || fileDirty;

  const pageableTemplates = useMemo(() => {
    if (!data) return [] as string[];
    return data.templates.filter((t) => isPageableTemplate(t, indexTemplate));
  }, [data, indexTemplate]);

  const unusedPageTemplates = useMemo(() => {
    const used = new Set(pageRows.map((r) => r.template).filter(Boolean));
    return pageableTemplates.filter((t) => !used.has(t));
  }, [pageableTemplates, pageRows]);

  const {
    confirmOpen,
    onOpenChange,
    handleConfirmOpenChange,
    handleDiscard,
    dialogContentProps,
    requestClose,
  } = useDialogCloseGuard({ isDirty, onClose });

  const selectedFile = data?.files.find((f) => f.path === selectedPath) ?? null;

  async function loadFile(path: string, detail: ThemeDetail) {
    const info = detail.files.find((f) => f.path === path);
    setSelectedPath(path);
    setError(null);
    setFileError(null);
    if (!info || info.kind !== 'text') {
      setFileContent('');
      setFileBaseline('');
      return;
    }
    setFileLoading(true);
    try {
      const text = await getThemeFileText(detail.id, path);
      setFileContent(text);
      setFileBaseline(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setFileContent('');
      setFileBaseline('');
    } finally {
      setFileLoading(false);
    }
  }

  function applyDetail(next: ThemeDetail) {
    queryClient.setQueryData(['theme', next.id], next);
    setName(next.name);
    setVersion(next.version);
    setIndexTemplate(next.index || 'podcast');
    setPageRows(pagesToRows(next.pages ?? {}));
    setMetaBaseline(
      metadataSnapshot(next.name, next.version, next.index || 'podcast', next.pages ?? {}),
    );
    void queryClient.invalidateQueries({ queryKey: ['themes'] });
    void queryClient.invalidateQueries({ queryKey: ['themes', 'builtins'] });
  }

  const saveMetaMutation = useMutation({
    mutationFn: () =>
      patchTheme(themeId!, {
        name: name.trim(),
        version: version.trim(),
        index: indexTemplate.trim(),
        pages: rowsToPages(pageRows),
      }),
    onSuccess: (next) => {
      setError(null);
      setMetadataError(null);
      applyDetail(next);
    },
    onError: (err: Error, target: MetadataSaveTarget) => {
      setMetadataError({ target, message: err.message });
    },
  });

  const saveFileMutation = useMutation({
    mutationFn: () => putThemeFileText(themeId!, selectedPath!, fileContent),
    onSuccess: (next) => {
      setError(null);
      setFileError(null);
      applyDetail(next);
      setFileBaseline(fileContent);
    },
    onError: (err: Error) => setFileError(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadThemeFile(themeId!, selectedPath!, file),
    onSuccess: async (next) => {
      setError(null);
      setFileError(null);
      applyDetail(next);
      if (selectedPath && next.files.find((f) => f.path === selectedPath)?.kind === 'text') {
        await loadFile(selectedPath, next);
      }
    },
    onError: (err: Error) => setFileError(err.message),
  });

  const createFileMutation = useMutation({
    mutationFn: (path: string) => createThemeFile(themeId!, path),
    onSuccess: async (next, path) => {
      setError(null);
      applyDetail(next);
      setAddKind(null);
      setAddName('');
      await loadFile(path, next);
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (path: string) => deleteThemeFile(themeId!, path),
    onSuccess: (next) => {
      setError(null);
      applyDetail(next);
      setDeleteFilePath(null);
      setSelectedPath(null);
      setFileContent('');
      setFileBaseline('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const scopeMutation = useMutation({
    mutationFn: (scope: 'server' | 'user') => setThemeScope(themeId!, scope),
    onSuccess: async (result) => {
      setError(null);
      setScopeConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
      void queryClient.invalidateQueries({ queryKey: ['themes', 'builtins'] });
      queryClient.removeQueries({ queryKey: ['theme', themeId] });
      const next = await queryClient.fetchQuery({
        queryKey: ['theme', result.id],
        queryFn: () => getTheme(result.id),
      });
      applyDetail(next);
      onThemeIdChange?.(result.id);
    },
    onError: (err: Error) => {
      setScopeConfirm(null);
      setError(err.message);
    },
  });

  function handleAddSubmit() {
    const raw = addName.trim().toLowerCase();
    if (!raw || !addKind) return;
    if (addKind === 'template') {
      const base = raw.replace(/\.liquid$/i, '');
      createFileMutation.mutate(`templates/${base}.liquid`);
    } else {
      const base = raw.replace(/\.css$/i, '');
      createFileMutation.mutate(`css/${base}.css`);
    }
  }

  const busy =
    saveMetaMutation.isPending ||
    saveFileMutation.isPending ||
    uploadMutation.isPending ||
    createFileMutation.isPending ||
    deleteFileMutation.isPending ||
    scopeMutation.isPending;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.content}
            aria-describedby={undefined}
            onPointerDownOutside={(e) => {
              dialogContentProps.onPointerDownOutside(e);
            }}
            onInteractOutside={(e) => {
              dialogContentProps.onInteractOutside(e);
            }}
            onEscapeKeyDown={dialogContentProps.onEscapeKeyDown}
          >
            <div className={styles.header}>
              <div className={styles.headerText}>
                <Dialog.Title className={styles.title}>
                  {data?.name ? `Edit ${data.name}` : 'Edit theme'}
                </Dialog.Title>
                <p className={styles.subtitle}>
                  {data
                    ? `Package id: ${data.packageId} · ${data.scope === 'server' ? 'Server theme' : 'Your theme'}`
                    : 'Loading theme…'}
                </p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={requestClose}
                aria-label="Close theme editor"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>

            <div className={styles.body}>
              {isLoading && <p className={styles.muted}>Loading theme…</p>}
              {isError && (
                <p className={styles.error} role="alert">
                  Failed to load theme.{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => void refetch()}>
                    Retry
                  </button>
                </p>
              )}
              {error && (
                <div className={styles.errorCard} role="alert">
                  <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                  <p className={styles.errorMessage}>{error}</p>
                </div>
              )}

              {data && (
                <>
                  {isAdmin && (
                    <section className={styles.card}>
                      <h3 className={styles.cardTitle}>Server Theme</h3>
                      <p className={styles.cardHint}>
                        Enabled makes this package available to every show. Disabled keeps it as
                        your personal copy.
                      </p>
                      <div className={styles.plansSetting}>
                        <div className={styles.plansSettingText}>
                          <span className={styles.plansSettingLabel}>Server-wide package</span>
                        </div>
                        <div className={styles.segmented} role="group" aria-label="Server theme">
                          <button
                            type="button"
                            className={
                              data.scope !== 'server' ? styles.segmentedActive : styles.segmentedBtn
                            }
                            aria-pressed={data.scope !== 'server'}
                            disabled={busy}
                            onClick={() => {
                              if (data.scope === 'server') setScopeConfirm('user');
                            }}
                          >
                            Disabled
                          </button>
                          <button
                            type="button"
                            className={
                              data.scope === 'server' ? styles.segmentedActive : styles.segmentedBtn
                            }
                            aria-pressed={data.scope === 'server'}
                            disabled={busy}
                            onClick={() => {
                              if (data.scope !== 'server') setScopeConfirm('server');
                            }}
                          >
                            Enabled
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  <section className={styles.card}>
                    <h3 className={styles.cardTitle}>Details</h3>
                    <div className={styles.fieldsGrid}>
                      <label className={styles.field}>
                        Name
                        <input
                          className={styles.input}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={120}
                          disabled={busy}
                        />
                      </label>
                      <label className={styles.field}>
                        Version
                        <input
                          className={styles.input}
                          value={version}
                          onChange={(e) => setVersion(e.target.value)}
                          maxLength={64}
                          disabled={busy}
                        />
                      </label>
                    </div>
                    {metadataError?.target === 'details' && (
                      <div className={styles.errorCard} role="alert">
                        <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                        <p className={styles.errorMessage}>{metadataError.message}</p>
                      </div>
                    )}
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={!metaDirty || busy}
                        onClick={() => saveMetaMutation.mutate('details')}
                      >
                        <Save size={16} strokeWidth={2} aria-hidden />
                        {saveMetaMutation.isPending ? 'Saving…' : 'Save details'}
                      </button>
                    </div>
                  </section>

                  <section className={styles.card}>
                    <h3 className={styles.cardTitle}>Routing</h3>
                    <p className={styles.cardHint}>
                      Choose which template opens when someone visits your show&apos;s feed home.
                      Below that, map any extra templates to public page URLs (for example{' '}
                      <code className={styles.inlineCode}>about</code> →{' '}
                      <code className={styles.inlineCode}>about.html</code>), so links like About or
                      Support work.
                    </p>
                    <label className={styles.field}>
                      Home page template
                      <select
                        className={styles.input}
                        value={indexTemplate}
                        onChange={(e) => {
                          const nextIndex = e.target.value;
                          setIndexTemplate(nextIndex);
                          setPageRows((rows) =>
                            rows.filter((r) => r.template !== nextIndex),
                          );
                        }}
                        disabled={busy}
                      >
                        {data.templates
                          .filter((t) => !t.startsWith('_'))
                          .map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={styles.pagesList}>
                      {pageRows.length === 0 ? (
                        <p className={styles.muted}>
                          No extra pages yet. Add a row to expose another template as its own URL.
                        </p>
                      ) : null}
                      {pageRows.map((row) => {
                        const optionsForRow = pageableTemplates.filter(
                          (t) =>
                            t === row.template ||
                            !pageRows.some((other) => other.id !== row.id && other.template === t),
                        );
                        return (
                          <div key={row.id} className={styles.pageRow}>
                            <label className={styles.pageField}>
                              Template
                              <select
                                className={styles.input}
                                value={row.template}
                                disabled={busy || optionsForRow.length === 0}
                                onChange={(e) => {
                                  const template = e.target.value;
                                  setPageRows((rows) =>
                                    rows.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            template,
                                            publicPath:
                                              !r.publicPath.trim() ||
                                              r.publicPath === `${r.template}.html`
                                                ? `${template}.html`
                                                : r.publicPath,
                                          }
                                        : r,
                                    ),
                                  );
                                }}
                              >
                                {!row.template ? (
                                  <option value="" disabled>
                                    Select a template
                                  </option>
                                ) : null}
                                {row.template && !optionsForRow.includes(row.template) ? (
                                  <option value={row.template}>{row.template}</option>
                                ) : null}
                                {optionsForRow.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={styles.pageField}>
                              Public URL file
                              <input
                                className={styles.input}
                                value={row.publicPath}
                                placeholder="about.html"
                                disabled={busy}
                                onChange={(e) => {
                                  const publicPath = e.target.value;
                                  setPageRows((rows) =>
                                    rows.map((r) =>
                                      r.id === row.id ? { ...r, publicPath } : r,
                                    ),
                                  );
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              aria-label="Remove page mapping"
                              disabled={busy}
                              onClick={() =>
                                setPageRows((rows) => rows.filter((r) => r.id !== row.id))
                              }
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {metadataError?.target === 'routing' && (
                      <div className={styles.errorCard} role="alert">
                        <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                        <p className={styles.errorMessage}>{metadataError.message}</p>
                      </div>
                    )}
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={busy || unusedPageTemplates.length === 0}
                        onClick={() => {
                          const template = unusedPageTemplates[0] ?? '';
                          setPageRows((rows) => [
                            ...rows,
                            {
                              id: newPageRowId(),
                              template,
                              publicPath: template ? `${template}.html` : '',
                            },
                          ]);
                        }}
                      >
                        <Plus size={16} strokeWidth={2} aria-hidden />
                        Add Page
                      </button>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={!metaDirty || busy}
                        onClick={() => saveMetaMutation.mutate('routing')}
                      >
                        <Save size={16} strokeWidth={2} aria-hidden />
                        Save routing
                      </button>
                    </div>
                  </section>

                  <section className={styles.card}>
                    <h3 className={styles.cardTitle}>Files</h3>
                    <p className={styles.cardHint}>
                      Edit templates and CSS as text. Images can be previewed and replaced.
                    </p>
                    <div className={styles.filesLayout}>
                      <div className={styles.fileListPane}>
                        <ul className={styles.fileList}>
                          {data.files.map((f) => (
                            <li key={f.path}>
                              <button
                                type="button"
                                className={
                                  selectedPath === f.path
                                    ? styles.fileItemActive
                                    : styles.fileItem
                                }
                                onClick={() => void loadFile(f.path, data)}
                                disabled={busy || (fileDirty && selectedPath !== f.path)}
                              >
                                {f.path}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className={styles.fileListActions}>
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            disabled={busy}
                            onClick={() => {
                              setAddKind('template');
                              setAddName('');
                            }}
                          >
                            Add template
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            disabled={busy}
                            onClick={() => {
                              setAddKind('css');
                              setAddName('');
                            }}
                          >
                            Add CSS
                          </button>
                        </div>
                        {addKind && (
                          <div className={styles.addRow}>
                            <input
                              className={styles.input}
                              value={addName}
                              placeholder={
                                addKind === 'template' ? 'about' : 'custom'
                              }
                              disabled={busy}
                              onChange={(e) => setAddName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddSubmit();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className={styles.primaryBtn}
                              disabled={busy || !addName.trim()}
                              onClick={handleAddSubmit}
                            >
                              Create
                            </button>
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              disabled={busy}
                              onClick={() => {
                                setAddKind(null);
                                setAddName('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      <div className={styles.fileEditorPane}>
                        {!selectedPath && (
                          <p className={styles.muted}>Select a file to edit or preview.</p>
                        )}
                        {selectedPath && selectedFile?.kind === 'text' && (
                          <>
                            {fileError && (
                              <div className={styles.errorCard} role="alert">
                                <CircleAlert size={18} className={styles.errorIcon} aria-hidden />
                                <p className={styles.errorMessage}>{fileError}</p>
                              </div>
                            )}
                            <div className={styles.editorToolbar}>
                              <span className={styles.editorPath}>{selectedPath}</span>
                              <div className={styles.editorToolbarActions}>
                                {selectedPath !== 'theme.json' &&
                                  !REQUIRED_FILES.has(selectedPath) && (
                                  <button
                                    type="button"
                                    className={styles.dangerBtn}
                                    disabled={busy}
                                    onClick={() => setDeleteFilePath(selectedPath)}
                                  >
                                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                                    Delete
                                  </button>
                                )}
                                {selectedPath !== 'theme.json' && (
                                  <button
                                    type="button"
                                    className={styles.secondaryBtn}
                                    disabled={busy}
                                    onClick={() => replaceInputRef.current?.click()}
                                  >
                                    <Upload size={16} strokeWidth={2} aria-hidden />
                                    Upload Replace
                                  </button>
                                )}
                                {selectedPath !== 'theme.json' && (
                                  <button
                                    type="button"
                                    className={styles.primaryBtn}
                                    disabled={!fileDirty || busy || fileLoading}
                                    onClick={() => saveFileMutation.mutate()}
                                  >
                                    <Save size={16} strokeWidth={2} aria-hidden />
                                    {saveFileMutation.isPending ? 'Saving…' : 'Save'}
                                  </button>
                                )}
                              </div>
                            </div>
                            {selectedPath === 'theme.json' ? (
                              <p className={styles.muted}>
                                theme.json is edited from Details and Routing above. This view is
                                read-only.
                              </p>
                            ) : null}
                            {fileLoading ? (
                              <p className={styles.muted}>Loading file…</p>
                            ) : (
                              <textarea
                                className={styles.codeArea}
                                value={fileContent}
                                onChange={(e) => {
                                  setFileContent(e.target.value);
                                  setFileError(null);
                                }}
                                spellCheck={false}
                                disabled={busy || selectedPath === 'theme.json'}
                                readOnly={selectedPath === 'theme.json'}
                              />
                            )}
                          </>
                        )}
                        {selectedPath && selectedFile?.kind === 'image' && (
                          <>
                            <div className={styles.editorToolbar}>
                              <span className={styles.editorPath}>{selectedPath}</span>
                              <div className={styles.editorToolbarActions}>
                                {!REQUIRED_FILES.has(selectedPath) && (
                                  <button
                                    type="button"
                                    className={styles.dangerBtn}
                                    disabled={busy}
                                    onClick={() => setDeleteFilePath(selectedPath)}
                                  >
                                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                                    Delete
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={styles.primaryBtn}
                                  disabled={busy}
                                  onClick={() => replaceInputRef.current?.click()}
                                >
                                  <Upload size={16} strokeWidth={2} aria-hidden />
                                  Replace
                                </button>
                              </div>
                            </div>
                            <div className={styles.imagePreview}>
                              <img
                                src={themeAssetPreviewUrl(data.id, data.scope, selectedPath)}
                                alt={selectedPath}
                              />
                            </div>
                          </>
                        )}
                        <input
                          ref={replaceInputRef}
                          type="file"
                          className={styles.hiddenInput}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file && selectedPath) uploadMutation.mutate(file);
                          }}
                        />
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.secondaryBtn} onClick={requestClose}>
                Close
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <UnsavedChangesConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />

      <Dialog.Root
        open={!!scopeConfirm}
        onOpenChange={(o) => !o && setScopeConfirm(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlayOnModal} />
          <Dialog.Content className={styles.confirmContent}>
            <Dialog.Title className={styles.confirmTitle}>
              {scopeConfirm === 'server' ? 'Enable server theme?' : 'Disable server theme?'}
            </Dialog.Title>
            <Dialog.Description className={styles.confirmDescription}>
              {scopeConfirm === 'server'
                ? 'This moves the package into server themes, removes your personal copy, and resets podcasts using the personal id to the default layout.'
                : 'This copies the package into your themes, deletes the server package, and resets podcasts using the server id to the default layout.'}
            </Dialog.Description>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setScopeConfirm(null)}
                disabled={scopeMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!scopeConfirm || scopeMutation.isPending}
                onClick={() => scopeConfirm && scopeMutation.mutate(scopeConfirm)}
              >
                {scopeMutation.isPending ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={!!deleteFilePath}
        onOpenChange={(o) => !o && setDeleteFilePath(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlayOnModal} />
          <Dialog.Content className={styles.confirmContent}>
            <Dialog.Title className={styles.confirmTitle}>Delete file?</Dialog.Title>
            <Dialog.Description className={styles.confirmDescription}>
              {deleteFilePath
                ? `Permanently delete "${deleteFilePath}" from this theme package.`
                : 'Permanently delete this file.'}
            </Dialog.Description>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setDeleteFilePath(null)}
                disabled={deleteFileMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={!deleteFilePath || deleteFileMutation.isPending}
                onClick={() => deleteFilePath && deleteFileMutation.mutate(deleteFilePath)}
              >
                {deleteFileMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
