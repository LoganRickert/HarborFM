import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Rss, ExternalLink, List, Settings as GearIcon, Cloud, X, FlaskConical, UploadCloud, BarChart3 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { getPodcast } from '../api/podcasts';
import { getAuthRssPreviewUrl } from '../api/rss';
import { listExports, createExport, updateExport, testExport, deployExport, type Export } from '../api/exports';
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
              <button
                type="button"
                className={styles.cardSettings}
                onClick={() => setDetailsDialogOpen(true)}
                aria-label={`Edit details for ${podcast.title}`}
              >
                <GearIcon size={18} strokeWidth={2} />
              </button>
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
              The feed updates automatically when you save show details or create/update episodes. With an export destination you can deploy to S3.
            </p>
          </div>

          <ExportsSection podcastId={id} />
      </>
    </div>
  );
}

function ExportsSection({ podcastId }: { podcastId: string }) {
  const queryClient = useQueryClient();
  const { data: exportsList = [] } = useQuery({
    queryKey: ['exports', podcastId],
    queryFn: () => listExports(podcastId),
  });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createExport>[1]) => createExport(podcastId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (vars: { exportId: string; body: Parameters<typeof updateExport>[1] }) =>
      updateExport(vars.exportId, vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports', podcastId] });
      setDialogOpen(false);
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
  const deployMutation = useMutation({
    mutationFn: (exportId: string) => deployExport(exportId),
    onSuccess: () => {
      setDeployingId(null);
    },
    onError: () => setDeployingId(null),
  });

  // HarborFM supports a single export destination per podcast.
  // If multiple exist (older data), we use the most recently updated (API orders DESC).
  const export1 = exportsList[0];
  const hasAny = !!export1;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className={styles.card}>
      <div className={styles.exportHeader}>
        <div className={styles.exportTitle}>
          <Cloud size={18} strokeWidth={2} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Podcast Delivery (S3)</h2>
        </div>
        <button
          type="button"
          className={styles.gearBtn}
          onClick={() => setDialogOpen(true)}
          aria-label={hasAny ? 'Edit S3 export' : 'Set up S3 export'}
        >
          <GearIcon size={16} strokeWidth={2} aria-hidden="true" />
          {hasAny ? 'Edit' : 'Set up'}
        </button>
      </div>
      <p className={styles.sectionSub}>
        Deploy your RSS feed and episode audio files to an S3-compatible bucket. Credentials are stored encrypted and can’t be viewed again.
      </p>

      {exportsList.length === 0 ? <p className={styles.exportMuted}>No export destination configured.</p> : null}

      {export1 ? (
        <div className={styles.exportCard}>
          <strong>{export1.name}</strong>
          <div className={styles.exportMeta}>
            <span>
              <code>{export1.bucket}</code> <span aria-hidden="true">/</span>{' '}
              <code>{export1.prefix || '(root)'}</code>
            </span>
            <span>
              Region <code>{export1.region}</code>
            </span>
            {export1.endpoint_url ? (
              <span>Endpoint <code>{export1.endpoint_url}</code></span>
            ) : null}
            {export1.public_base_url ? (
              <span>
                Public base <code>{export1.public_base_url}</code>
              </span>
            ) : null}
          </div>
          <div className={styles.exportCardActions}>
            {(() => {
              const base = (export1.public_base_url ?? '').trim().replace(/\/$/, '');
              const prefix = (export1.prefix ?? '').trim().replace(/^\/|\/$/g, '');
              const feedUrl = base ? (prefix ? `${base}/${prefix}/feed.xml` : `${base}/feed.xml`) : null;
              return (
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={() => feedUrl && window.open(feedUrl, '_blank', 'noopener,noreferrer')}
                  disabled={!feedUrl}
                  title={feedUrl ? 'Open RSS feed on S3 in new tab' : 'Set public base URL to open RSS'}
                  aria-label="Open RSS feed on S3"
                >
                  <Rss size={16} aria-hidden />
                  RSS
                </button>
              );
            })()}
            <button
              type="button"
              className={styles.cancel}
              onClick={() => { setTestingId(export1.id); testMutation.mutate(export1.id); }}
              disabled={testingId === export1.id}
              aria-label="Test S3 connection"
            >
              <FlaskConical size={16} aria-hidden />
              {testingId === export1.id ? 'Testing…' : 'Test'}
            </button>
            <button
              type="button"
              className={styles.submit}
              onClick={() => { setDeployingId(export1.id); deployMutation.mutate(export1.id); }}
              disabled={deployingId === export1.id}
              aria-label="Deploy to S3"
            >
              <UploadCloud size={16} aria-hidden />
              {deployingId === export1.id ? 'Deploying…' : 'Deploy'}
            </button>
          </div>
          {testMutation.variables === export1.id && testMutation.isSuccess && testMutation.data?.ok === true && (
            <p className={`${styles.success} ${styles.exportResult}`}>
              Connection OK.
            </p>
          )}
          {testMutation.variables === export1.id && testMutation.isSuccess && testMutation.data?.ok === false && (
            <p className={`${styles.error} ${styles.exportResult}`}>
              {testMutation.data?.error || 'Test failed'}
            </p>
          )}
          {testMutation.isError && testMutation.variables === export1.id && (
            <p className={`${styles.error} ${styles.exportResult}`}>
              {testMutation.error?.message}
            </p>
          )}
          {deployMutation.isSuccess && deployMutation.variables === export1.id && (
            <p className={`${styles.success} ${styles.exportResult}`}>
              {deployMutation.data?.skipped != null && deployMutation.data.skipped > 0
                ? `Deployed ${deployMutation.data.uploaded} file(s), ${deployMutation.data.skipped} unchanged.`
                : `Deployed ${deployMutation.data?.uploaded} file(s).`}
            </p>
          )}
          {deployMutation.isError && deployMutation.variables === export1.id && (
            <p className={`${styles.error} ${styles.exportResult}`}>{deployMutation.error?.message}</p>
          )}
        </div>
      ) : null}

      <Dialog.Root open={dialogOpen} onOpenChange={(open) => !isSaving && setDialogOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={`${styles.dialogContent} ${styles.dialogContentWide}`}>
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
              {hasAny ? 'Edit S3 export' : 'Add S3 Export'}
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              Update the destination settings. Credentials are stored encrypted and cannot be viewed after saving.
            </Dialog.Description>

            <div className={styles.dialogBodyScroll}>
            <ExportForm
              open={dialogOpen}
              mode={export1 ? 'edit' : 'create'}
              initial={export1}
              onClose={() => setDialogOpen(false)}
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
    </div>
  );
}

function ExportForm({
  open,
  onClose,
  mode,
  initial,
  onSubmitCreate,
  onSubmitUpdate,
  isPending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initial?: Export;
  onSubmitCreate: (body: Parameters<typeof createExport>[1]) => void;
  onSubmitUpdate: (exportId: string, body: Parameters<typeof updateExport>[1]) => void;
  isPending: boolean;
  error?: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [bucket, setBucket] = useState(initial?.bucket ?? '');
  const [prefix, setPrefix] = useState(initial?.prefix ?? '');
  const [region, setRegion] = useState(initial?.region ?? 'us-east-1');
  const [endpointUrl, setEndpointUrl] = useState(initial?.endpoint_url ?? '');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState(initial?.public_base_url ?? '');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setBucket(initial?.bucket ?? '');
    setPrefix(initial?.prefix ?? '');
    setRegion(initial?.region ?? 'us-east-1');
    setEndpointUrl(initial?.endpoint_url ?? '');
    setPublicBaseUrl(initial?.public_base_url ?? '');
    setAccessKeyId('');
    setSecretAccessKey('');
  }, [open, initial]);

  return (
    <div>
      <form
        className={styles.addExportForm}
        onSubmit={(e) => {
          e.preventDefault();

          if (mode === 'create') {
            onSubmitCreate({
              provider: 's3',
              name,
              bucket,
              prefix,
              region,
              endpoint_url: endpointUrl || undefined,
              access_key_id: accessKeyId,
              secret_access_key: secretAccessKey,
              public_base_url: publicBaseUrl || undefined,
            });
            return;
          }

          const exportId = initial?.id;
          if (!exportId) return;
          const body: Parameters<typeof updateExport>[1] = {
            name,
            bucket,
            prefix,
            region,
            endpoint_url: endpointUrl ? endpointUrl : null,
            public_base_url: publicBaseUrl ? publicBaseUrl : null,
          };
          // Only send credentials if user filled them in.
          if (accessKeyId.trim() || secretAccessKey.trim()) {
            body.access_key_id = accessKeyId.trim();
            body.secret_access_key = secretAccessKey.trim();
          }
          onSubmitUpdate(exportId, body);
        }}
      >
        <label className={styles.label}>
          Name
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" required />
        </label>
        <label className={styles.label}>
          Bucket
          <input className={styles.input} value={bucket} onChange={(e) => setBucket(e.target.value)} required />
        </label>
        <label className={styles.label}>
          Prefix (e.g. podcasts/my-show/)
          <input className={styles.input} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
        <label className={styles.label}>
          Region
          <input className={styles.input} value={region} onChange={(e) => setRegion(e.target.value)} />
        </label>
        <label className={styles.label}>
          Endpoint URL (optional, for R2 or other S3-compatible)
          <input className={styles.input} type="url" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://account-id.r2.cloudflarestorage.com" />
        </label>
        <label className={styles.label}>
          Access Key ID
          <input
            className={styles.input}
            type="text"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            required={mode === 'create'}
            placeholder={mode === 'edit' ? '(leave blank to keep existing)' : ''}
          />
        </label>
        <label className={styles.label}>
          Secret Access Key
          <input
            className={styles.input}
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            required={mode === 'create'}
            placeholder={mode === 'edit' ? '(leave blank to keep existing)' : ''}
          />
        </label>
        <label className={styles.label}>
          Public base URL (optional, for enclosure URLs)
          <input className={styles.input} type="url" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://cdn.example.com/podcasts/my-show" />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.addExportActions}>
          <Dialog.Close asChild>
            <button type="button" className={styles.cancel} onClick={onClose} aria-label="Cancel export changes" disabled={isPending}>
              Cancel
            </button>
          </Dialog.Close>
          <button type="submit" className={styles.submit} disabled={isPending} aria-label="Save export">
            {isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add export'}
          </button>
        </div>
      </form>
    </div>
  );
}
