import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Rss, ExternalLink, List, Settings as GearIcon, Cloud, X, FlaskConical, UploadCloud, BarChart3, Plus, Trash2, Pencil } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { getPodcast } from '../api/podcasts';
import { getAuthRssPreviewUrl } from '../api/rss';
import { me, isReadOnly } from '../api/auth';
import { listExports, createExport, updateExport, testExport, deployAllExports, deleteExport, type Export, type ExportMode, type ExportCreateBody, type ExportUpdateBody, EXPORT_MODE_LABELS } from '../api/exports';
import { FullPageLoading } from '../components/Loading';
import { EditShowDetailsDialog } from './EditShowDetailsDialog';
import { Breadcrumb } from '../components/Breadcrumb';
import styles from './PodcastSettings.module.css';

export function PodcastSettings() {
  const { id } = useParams<{ id: string }>();
  const { data: podcast, isLoading, isFetching, isError } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const readOnly = isReadOnly(meData?.user);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  if (!id) return null;
  if (isLoading || (!podcast && isFetching)) return <FullPageLoading />;
  if (isError || !podcast) return <p className={styles.error}>Podcast not found.</p>;

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: podcast.title, mobileLabel: 'Podcast' },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumb items={breadcrumbItems} />

      <div className={styles.card}>
        <div className={styles.podcastHero}>
          {(podcast.artwork_url || podcast.artwork_filename) && (
            <img
              src={podcast.artwork_url ?? (podcast.artwork_filename ? `/api/public/artwork/${podcast.id}/${encodeURIComponent(podcast.artwork_filename)}` : '')}
              alt=""
              className={styles.podcastHeroArtwork}
            />
          )}
          <div className={styles.podcastHeroMain}>
            <h1 className={styles.cardTitle}>{podcast.title}</h1>
            {podcast.description && (
              <p className={styles.podcastHeroDescription}>{podcast.description}</p>
            )}
            <div className={styles.cardHeaderActions}>
              <Link to={`/podcasts/${id}/analytics`} className={styles.cardHeaderSecondary}>
                <BarChart3 size={16} strokeWidth={2} aria-hidden />
                Analytics
              </Link>
              <Link to={`/podcasts/${id}/episodes`} className={styles.cardHeaderPrimary}>
                <List size={16} strokeWidth={2} aria-hidden />
                Episodes
              </Link>
              {!readOnly && (
                <button
                  type="button"
                  className={styles.cardSettings}
                  onClick={() => setDetailsDialogOpen(true)}
                  aria-label={`Edit details for ${podcast.title}`}
                >
                  <GearIcon size={18} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.podcastDetails}>
          <h2 className={styles.podcastDetailsTitle}>Show details</h2>
          <dl className={styles.podcastDetailsGrid}>
            <div className={styles.podcastDetailsItem}>
              <dt className={styles.podcastDetailsTerm}>Public feed</dt>
              <dd className={styles.podcastDetailsValue}>
                <Link to={`/feed/${podcast.slug}`} className={styles.podcastDetailsActionLink}>
                  <Rss size={16} strokeWidth={2} aria-hidden />
                  View public feed
                </Link>
              </dd>
            </div>
            {podcast.site_url && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Website</dt>
                <dd className={styles.podcastDetailsValue}>
                  <a href={podcast.site_url} target="_blank" rel="noopener noreferrer" className={styles.podcastDetailsActionLink}>
                    <ExternalLink size={16} strokeWidth={2} aria-hidden />
                    Visit website
                  </a>
                </dd>
              </div>
            )}
            {podcast.author_name && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Author</dt>
                <dd className={styles.podcastDetailsValue}>{podcast.author_name}</dd>
              </div>
            )}
            {[podcast.category_primary, podcast.category_secondary, podcast.category_tertiary].some(Boolean) && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Categories</dt>
                <dd className={styles.podcastDetailsValue}>
                  {[podcast.category_primary, podcast.category_secondary, podcast.category_tertiary].filter(Boolean).join(', ')}
                </dd>
              </div>
            )}
            {podcast.language && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Language</dt>
                <dd className={styles.podcastDetailsValue}>{podcast.language}</dd>
              </div>
            )}
            {podcast.medium && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Medium</dt>
                <dd className={styles.podcastDetailsValue}>{podcast.medium}</dd>
              </div>
            )}
            <div className={styles.podcastDetailsItem}>
              <dt className={styles.podcastDetailsTerm}>Type</dt>
              <dd className={styles.podcastDetailsValue}>{podcast.itunes_type === 'serial' ? 'Serial' : 'Episodic'}</dd>
            </div>
            {podcast.owner_name && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Owner</dt>
                <dd className={styles.podcastDetailsValue}>{podcast.owner_name}</dd>
              </div>
            )}
            {podcast.email && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Email</dt>
                <dd className={styles.podcastDetailsValue}>
                  <a href={`mailto:${podcast.email}`} className={styles.podcastDetailsLink}>{podcast.email}</a>
                </dd>
              </div>
            )}
            {!!podcast.explicit && (
              <div className={styles.podcastDetailsItem}>
                <dt className={styles.podcastDetailsTerm}>Explicit</dt>
                <dd className={styles.podcastDetailsValue}>Yes</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {detailsDialogOpen && (
        <EditShowDetailsDialog
          open
          podcastId={id}
          onClose={() => setDetailsDialogOpen(false)}
        />
      )}

      <>
          <div className={styles.card}>
            <div className={styles.rssHeader}>
              <div className={styles.rssTitle}>
                <Rss size={18} strokeWidth={2} aria-hidden="true" />
                <h2 className={styles.sectionTitle}>RSS Feed</h2>
              </div>
              <a
                href={getAuthRssPreviewUrl(podcast.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.rssBtn}
              >
                Preview feed XML
                <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
              </a>
            </div>
            <p className={styles.sectionSub}>
              The feed updates automatically when you save show details or create/update episodes. With an export destination you can deploy your feed and media to storage (S3, FTP, SFTP, WebDAV, IPFS, or SMB).
            </p>
          </div>

          <ExportsSection podcastId={id} readOnly={readOnly} />
      </>
    </div>
  );
}

function ExportsSection({ podcastId, readOnly = false }: { podcastId: string; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const { data: exportsList = [] } = useQuery({
    queryKey: ['exports', podcastId],
    queryFn: () => listExports(podcastId),
  });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deployingAll, setDeployingAll] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExportId, setEditingExportId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createExport>[1]) => createExport(podcastId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
      setEditingExportId(null);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (vars: { exportId: string; body: Parameters<typeof updateExport>[1] }) =>
      updateExport(vars.exportId, vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
      setEditingExportId(null);
    },
  });
  const testMutation = useMutation({
    mutationFn: (exportId: string) => testExport(exportId),
    onSuccess: () => {
      setTestingId(null);
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
    },
    onError: () => setTestingId(null),
  });
  const deployAllMutation = useMutation({
    mutationFn: () => deployAllExports(podcastId),
    onSuccess: () => setDeployingAll(false),
    onError: () => setDeployingAll(false),
  });
  const [exportToDelete, setExportToDelete] = useState<Export | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (exportId: string) => deleteExport(exportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setExportToDelete(null);
    },
  });

  const editingExport = editingExportId ? exportsList.find((e) => e.id === editingExportId) : undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const openAddDialog = () => {
    setEditingExportId(null);
    setDialogOpen(true);
  };
  const openEditDialog = (exp: Export) => {
    setEditingExportId(exp.id);
    setDialogOpen(true);
  };

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Cloud size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Podcast Delivery</h2>
        </div>
        {!readOnly && (
          <div className={styles.exportHeaderActions}>
            <button
              type="button"
              className={styles.gearBtn}
              onClick={openAddDialog}
              aria-label="Add delivery destination"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add Delivery
            </button>
            {exportsList.length > 0 && (
              <button
                type="button"
                className={styles.deployBtn}
                onClick={() => { setDeployingAll(true); deployAllMutation.mutate(); }}
                disabled={deployingAll}
                aria-label="Deploy to all destinations"
              >
                <UploadCloud size={16} aria-hidden />
                {deployingAll ? 'Deploying...' : 'Deploy'}
              </button>
            )}
          </div>
        )}
      </div>
      <p className={styles.sectionSub}>
        Deploy your RSS feed and episode audio files to one or more destinations. Credentials are stored encrypted and cannot be viewed after saving.
      </p>

      {exportsList.length === 0 ? (
        <p className={styles.exportMuted}>No delivery destinations configured. Add one to get started.</p>
      ) : (
        <ul className={styles.exportList}>
          {exportsList.map((exp) => {
            const publicBase = (exp.public_base_url ?? '').trim().replace(/\/$/, '');
            const exportPrefix = (exp.prefix ?? '').trim().replace(/^\/|\/$/g, '');
            const feedUrl = publicBase
              ? (exportPrefix ? `${publicBase}/${exportPrefix}/feed.xml` : `${publicBase}/feed.xml`)
              : null;
            const isTesting = testingId === exp.id;
            return (
              <li key={exp.id} className={styles.exportCard}>
                <div className={styles.exportCardRow}>
                  <div className={styles.exportCardMeta}>
                    <strong>{exp.name}</strong>
                    <span className={styles.exportModeBadge}>{EXPORT_MODE_LABELS[exp.mode as ExportMode] ?? exp.mode}</span>
                  </div>
                  <div className={styles.exportCardActions}>
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={() => feedUrl && window.open(feedUrl, '_blank', 'noopener,noreferrer')}
                      disabled={!feedUrl}
                      title={feedUrl ? 'Open RSS feed' : 'Set public base URL to open RSS'}
                      aria-label={`Open RSS feed for ${exp.name}`}
                    >
                      <Rss size={16} aria-hidden />
                      RSS
                    </button>
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          className={styles.cancel}
                          onClick={() => { setTestingId(exp.id); testMutation.mutate(exp.id); }}
                          disabled={isTesting}
                          aria-label={`Test connection for ${exp.name}`}
                        >
                          <FlaskConical size={16} aria-hidden />
                          {isTesting ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          type="button"
                          className={styles.cancel}
                          onClick={() => openEditDialog(exp)}
                          aria-label={`Edit ${exp.name}`}
                        >
                          <Pencil size={16} aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.exportDeleteBtn}
                          onClick={() => setExportToDelete(exp)}
                          disabled={deleteMutation.isPending}
                          aria-label={`Delete ${exp.name}`}
                        >
                          <Trash2 size={16} aria-hidden />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {testMutation.variables === exp.id && testMutation.isSuccess && testMutation.data?.ok === true && (
                  <p className={`${styles.success} ${styles.exportResult}`}>Connection OK.</p>
                )}
                {testMutation.variables === exp.id && testMutation.isSuccess && testMutation.data?.ok === false && (
                  <p className={`${styles.error} ${styles.exportResult}`}>{testMutation.data?.error || 'Test failed'}</p>
                )}
                {testMutation.isError && testMutation.variables === exp.id && (
                  <p className={`${styles.error} ${styles.exportResult}`}>{testMutation.error?.message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && exportsList.length > 0 && (deployAllMutation.isSuccess && deployAllMutation.data?.results || deployAllMutation.isError) && (
        <div className={styles.deployAllRow}>
          {deployAllMutation.isSuccess && deployAllMutation.data?.results && (
            <div className={styles.deployAllResults}>
              {deployAllMutation.data.results.map((r) => (
                <p key={r.export_id} className={r.status === 'success' ? styles.success : styles.error}>
                  {r.name}: {r.status === 'success'
                    ? `Uploaded ${r.uploaded} file(s)${r.skipped > 0 ? `, ${r.skipped} unchanged` : ''}.`
                    : (r.errors ?? ['Failed']).join('; ')}
                </p>
              ))}
            </div>
          )}
          {deployAllMutation.isError && (
            <p className={styles.error}>{deployAllMutation.error?.message}</p>
          )}
        </div>
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={(open) => !isSaving && (setDialogOpen(open), !open && setEditingExportId(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide} ${styles.dialogShowDetailsGrid}`}>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.dialogClose}
                aria-label="Close"
                disabled={isSaving}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </Dialog.Close>
            <Dialog.Title className={styles.dialogTitle}>
              {editingExport ? 'Edit Delivery' : 'Add Delivery'}
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {editingExport ? 'Update the destination settings.' : 'Choose a destination type and enter connection details.'} Credentials are stored encrypted and cannot be viewed after saving.
            </Dialog.Description>

            <div className={styles.dialogBodyScroll}>
              <ExportForm
                open={dialogOpen}
                formMode={editingExport ? 'edit' : 'create'}
                initial={editingExport}
                onClose={() => { setDialogOpen(false); setEditingExportId(null); }}
                onSubmitCreate={(body) => createMutation.mutate(body)}
                onSubmitUpdate={(exportId, body) => updateMutation.mutate({ exportId, body })}
                isPending={isSaving}
                error={
                  createMutation.isError
                    ? createMutation.error?.message
                    : updateMutation.isError
                      ? updateMutation.error?.message
                      : undefined
                }
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!exportToDelete} onOpenChange={(open) => !open && setExportToDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={styles.dialogContent}>
            <Dialog.Title className={styles.dialogTitle}>Remove delivery?</Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {exportToDelete
                ? `This will permanently remove "${exportToDelete.name}". This cannot be undone.`
                : 'This will permanently remove this destination. This cannot be undone.'}
            </Dialog.Description>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.cancel} aria-label="Cancel">Cancel</button>
              </Dialog.Close>
              <button
                type="button"
                className={styles.dialogConfirmRemove}
                onClick={() => exportToDelete && deleteMutation.mutate(exportToDelete.id)}
                disabled={deleteMutation.isPending}
                aria-label="Confirm remove delivery"
              >
                {deleteMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ExportForm({
  open,
  onClose,
  formMode,
  initial,
  onSubmitCreate,
  onSubmitUpdate,
  isPending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  formMode: 'create' | 'edit';
  initial?: Export;
  onSubmitCreate: (body: ExportCreateBody) => void;
  onSubmitUpdate: (exportId: string, body: ExportUpdateBody) => void;
  isPending: boolean;
  error?: string;
}) {
  const currentMode = (initial?.mode as ExportMode) ?? 'S3';
  const [exportMode, setExportMode] = useState<ExportMode>(currentMode);
  const [name, setName] = useState(initial?.name ?? '');
  const [publicBaseUrl, setPublicBaseUrl] = useState(initial?.public_base_url ?? '');
  const [fields, setFields] = useState<Record<string, string | number | boolean>>(() => ({
    bucket: '', prefix: '', region: 'auto', endpoint_url: '',
    access_key_id: '', secret_access_key: '',
    host: '', port: 21, username: '', password: '', path: '', secure: false,
    private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
    share: '', domain: '',
  }));
  const isEdit = formMode === 'edit';

  useEffect(() => {
    if (!open) return;
    const mode = (initial?.mode as ExportMode) ?? 'S3';
    setExportMode(mode);
    setName(initial?.name ?? '');
    setPublicBaseUrl(initial?.public_base_url ?? '');
    const isEditMode = formMode === 'edit';
    const defaultPort = mode === 'SFTP' ? 22 : 21;
    setFields({
      bucket: initial?.bucket ?? '', prefix: initial?.prefix ?? '', region: initial?.region ?? 'auto', endpoint_url: initial?.endpoint_url ?? '',
      access_key_id: '', secret_access_key: '',
      host: '', port: isEditMode ? '' : defaultPort, username: '', password: '', path: '', secure: false,
      private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
      share: '', domain: '',
    });
  }, [open, initial, formMode]);

  const set = (key: string, value: string | number | boolean) => setFields((p) => ({ ...p, [key]: value }));
  const v = (key: string) => fields[key] ?? '';

  const buildCreateBody = (): ExportCreateBody => {
    const nameTrim = name.trim();
    const pub = publicBaseUrl.trim() || undefined;
    switch (exportMode) {
      case 'S3':
        return {
          mode: 'S3',
          name: nameTrim,
          bucket: String(v('bucket')).trim(),
          prefix: String(v('prefix')).trim(),
          region: String(v('region')).trim(),
          endpoint_url: String(v('endpoint_url')).trim() || null,
          access_key_id: String(v('access_key_id')).trim(),
          secret_access_key: String(v('secret_access_key')).trim(),
          public_base_url: pub ?? null,
        };
      case 'FTP':
        return {
          mode: 'FTP',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: Number(v('port')) || 21,
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          path: String(v('path')).trim(),
          secure: Boolean(v('secure')),
          public_base_url: pub ?? null,
        };
      case 'SFTP':
        return {
          mode: 'SFTP',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: Number(v('port')) || 22,
          username: String(v('username')).trim(),
          password: String(v('password')).trim() || undefined,
          private_key: String(v('private_key')).trim() || undefined,
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      case 'WebDAV':
        return {
          mode: 'WebDAV',
          name: nameTrim,
          url: String(v('url')).trim(),
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      case 'IPFS':
        return {
          mode: 'IPFS',
          name: nameTrim,
          api_url: String(v('api_url')).trim(),
          api_key: String(v('api_key')).trim() || undefined,
          username: String(v('username')).trim() || undefined,
          password: String(v('password')).trim() || undefined,
          path: String(v('path')).trim(),
          gateway_url: String(v('gateway_url')).trim() || null,
          public_base_url: pub ?? null,
        };
      case 'SMB': {
        const smbPort = v('port');
        return {
          mode: 'SMB',
          name: nameTrim,
          host: String(v('host')).trim(),
          port: smbPort !== '' && smbPort !== undefined && Number(smbPort) > 0 ? Number(smbPort) : undefined,
          share: String(v('share')).trim(),
          username: String(v('username')).trim(),
          password: String(v('password')).trim(),
          domain: String(v('domain')).trim(),
          path: String(v('path')).trim(),
          public_base_url: pub ?? null,
        };
      }
      default:
        return { mode: 'S3', name: nameTrim, bucket: '', region: '', access_key_id: '', secret_access_key: '' };
    }
  };

  const buildUpdateBody = (): ExportUpdateBody => {
    const body: ExportUpdateBody = { mode: exportMode, name: name.trim(), public_base_url: publicBaseUrl.trim() || null };
    if (exportMode === 'S3') {
      if (String(v('bucket')).trim()) body.bucket = String(v('bucket')).trim();
      if (String(v('region')).trim()) body.region = String(v('region')).trim();
      const ep = String(v('endpoint_url')).trim();
      body.endpoint_url = ep || null;
      if (String(v('access_key_id')).trim() || String(v('secret_access_key')).trim()) {
        body.access_key_id = String(v('access_key_id')).trim();
        body.secret_access_key = String(v('secret_access_key')).trim();
      }
      if (String(v('prefix')).trim() !== undefined) body.prefix = String(v('prefix')).trim();
    } else {
      if (String(v('host')).trim()) body.host = String(v('host')).trim();
      const portVal = v('port');
      if (portVal !== '' && portVal !== undefined && Number(portVal) > 0) body.port = Number(portVal);
      if (String(v('username')).trim()) body.username = String(v('username')).trim();
      if (String(v('password')).trim()) body.password = String(v('password')).trim();
      if (String(v('path')).trim() !== undefined) body.path = String(v('path')).trim();
      if (exportMode === 'FTP') body.secure = Boolean(v('secure'));
      if (exportMode === 'SFTP' && String(v('private_key')).trim()) body.private_key = String(v('private_key')).trim();
      if (exportMode === 'WebDAV' && String(v('url')).trim()) body.url = String(v('url')).trim();
      if (exportMode === 'IPFS') {
        if (String(v('api_url')).trim()) body.api_url = String(v('api_url')).trim();
        if (String(v('api_key')).trim()) body.api_key = String(v('api_key')).trim();
        if (String(v('username')).trim()) body.username = String(v('username')).trim();
        if (String(v('password')).trim()) body.password = String(v('password')).trim();
        const gw = String(v('gateway_url')).trim();
        body.gateway_url = gw || null;
      }
      if (exportMode === 'SMB') {
        const smbPortVal = v('port');
        if (smbPortVal !== '' && smbPortVal !== undefined && Number(smbPortVal) > 0) body.port = Number(smbPortVal);
        if (String(v('share')).trim()) body.share = String(v('share')).trim();
        if (String(v('domain')).trim()) body.domain = String(v('domain')).trim();
      }
    }
    return body;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formMode === 'create') {
      onSubmitCreate(buildCreateBody());
    } else if (initial?.id) {
      onSubmitUpdate(initial.id, buildUpdateBody());
    }
  };

  const placeholderKeep = isEdit ? '(Leave blank to keep existing)' : '';

  return (
    <div>
      <form className={styles.addExportForm} onSubmit={handleSubmit}>
        <label className={styles.label}>
          Name
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" required />
        </label>

        <label className={styles.label}>
          Public base URL (optional)
          <input className={styles.input} type="url" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://cdn.example.com" />
        </label>

        <div className={styles.label}>
          Destination type
          <div className={`${styles.statusToggle} ${styles.exportModeToggle}`} role="group" aria-label="Export destination type">
            {(Object.entries(EXPORT_MODE_LABELS) as [ExportMode, string][]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={exportMode === m ? styles.statusToggleActive : styles.statusToggleBtn}
                onClick={() => {
                  if (m === exportMode) return;
                  setExportMode(m);
                  setFields({
                    bucket: '', prefix: '', region: 'auto', endpoint_url: '',
                    access_key_id: '', secret_access_key: '',
                    host: '', port: m === 'SMB' ? '' : (m === 'SFTP' ? 22 : 21), username: '', password: '', path: '', secure: false,
                    private_key: '', url: '', api_url: '', api_key: '', gateway_url: '',
                    share: '', domain: '',
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {exportMode === 'S3' && (
          <>
            <label className={styles.label}>Bucket
              <input className={styles.input} value={String(v('bucket'))} onChange={(e) => set('bucket', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Prefix (e.g. podcasts/my-show/)
              <input className={styles.input} value={String(v('prefix'))} onChange={(e) => set('prefix', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} />
            </label>
            <label className={styles.label}>Region
              <input className={styles.input} value={String(v('region'))} onChange={(e) => set('region', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Endpoint URL (optional, for R2 or other S3-compatible)
              <input className={styles.input} type="url" value={String(v('endpoint_url'))} onChange={(e) => set('endpoint_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://...'} />
            </label>
            <label className={styles.label}>Access Key ID
              <input className={styles.input} type="text" value={String(v('access_key_id'))} onChange={(e) => set('access_key_id', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Secret Access Key
              <input className={styles.input} type="password" value={String(v('secret_access_key'))} onChange={(e) => set('secret_access_key', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
          </>
        )}

        {(exportMode === 'FTP' || exportMode === 'SFTP') && (
          <>
            <label className={styles.label}>Host
              <input className={styles.input} value={String(v('host'))} onChange={(e) => set('host', e.target.value)} placeholder={isEdit ? placeholderKeep : 'ftp.example.com'} required={!isEdit} />
            </label>
            <label className={styles.label}>Port
              <input className={styles.input} type="number" value={v('port') === '' || v('port') === undefined ? '' : String(v('port'))} onChange={(e) => set('port', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))} placeholder={isEdit ? placeholderKeep : undefined} min={1} max={65535} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            {exportMode === 'SFTP' && (
              <label className={styles.label}>Private key (optional, alternative to password)
                <textarea className={styles.input} rows={3} value={String(v('private_key'))} onChange={(e) => set('private_key', e.target.value)} placeholder={placeholderKeep} />
              </label>
            )}
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/podcasts/my-show'} />
            </label>
            {exportMode === 'FTP' && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(v('secure'))}
                  onChange={(e) => set('secure', e.target.checked)}
                />
                <span className="toggle__track" aria-hidden="true" />
                <span>Use TLS (FTPS)</span>
              </label>
            )}
          </>
        )}

        {exportMode === 'WebDAV' && (
          <>
            <label className={styles.label}>WebDAV URL
              <input className={styles.input} type="url" value={String(v('url'))} onChange={(e) => set('url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://...'} required={!isEdit} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/remote/path'} />
            </label>
          </>
        )}

        {exportMode === 'IPFS' && (
          <>
            <label className={styles.label}>IPFS API URL
              <input className={styles.input} type="url" value={String(v('api_url'))} onChange={(e) => set('api_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'http://127.0.0.1:5001'} required={!isEdit} />
            </label>
            <label className={styles.label}>API key (optional)
              <input className={styles.input} type="password" value={String(v('api_key'))} onChange={(e) => set('api_key', e.target.value)} placeholder={placeholderKeep} />
            </label>
            <label className={styles.label}>Username (for Basic auth, e.g. Caddy)
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} />
            </label>
            <label className={styles.label}>Password (for Basic auth)
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} />
            </label>
            <label className={styles.label}>Gateway URL (for enclosure URLs, e.g. https://ipfs.io/ipfs/)
              <input className={styles.input} type="url" value={String(v('gateway_url'))} onChange={(e) => set('gateway_url', e.target.value)} placeholder={isEdit ? placeholderKeep : 'https://ipfs.io/ipfs/'} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/deploy'} />
            </label>
          </>
        )}

        {exportMode === 'SMB' && (
          <>
            <label className={styles.label}>Host
              <input className={styles.input} value={String(v('host'))} onChange={(e) => set('host', e.target.value)} placeholder={isEdit ? placeholderKeep : 'server'} required={!isEdit} />
            </label>
            <label className={styles.label}>Port (optional, default 445)
              <input className={styles.input} type="number" value={v('port') === '' || v('port') === undefined ? '' : String(v('port'))} onChange={(e) => set('port', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))} placeholder={isEdit ? placeholderKeep : undefined} min={1} max={65535} />
            </label>
            <label className={styles.label}>Share name
              <input className={styles.input} value={String(v('share'))} onChange={(e) => set('share', e.target.value)} placeholder={isEdit ? placeholderKeep : 'podcasts'} required={!isEdit} />
            </label>
            <label className={styles.label}>Username
              <input className={styles.input} value={String(v('username'))} onChange={(e) => set('username', e.target.value)} placeholder={isEdit ? placeholderKeep : undefined} required={!isEdit} />
            </label>
            <label className={styles.label}>Password
              <input className={styles.input} type="password" value={String(v('password'))} onChange={(e) => set('password', e.target.value)} placeholder={placeholderKeep} required={!isEdit} />
            </label>
            <label className={styles.label}>Domain (optional)
              <input className={styles.input} value={String(v('domain'))} onChange={(e) => set('domain', e.target.value)} placeholder={isEdit ? placeholderKeep : 'WORKGROUP'} />
            </label>
            <label className={styles.label}>Path
              <input className={styles.input} value={String(v('path'))} onChange={(e) => set('path', e.target.value)} placeholder={isEdit ? placeholderKeep : '/subfolder'} />
            </label>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.addExportActions}>
          <Dialog.Close asChild>
            <button type="button" className={styles.cancel} onClick={onClose} aria-label="Cancel" disabled={isPending}>Cancel</button>
          </Dialog.Close>
          <button type="submit" className={styles.submit} disabled={isPending} aria-label="Save export">
            {isPending ? 'Saving...' : formMode === 'edit' ? 'Save changes' : 'Add export'}
          </button>
        </div>
      </form>
    </div>
  );
}
