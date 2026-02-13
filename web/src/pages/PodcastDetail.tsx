import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPodcast } from '../api/podcasts';
import { getPublicConfig } from '../api/public';
import { me, isReadOnly } from '../api/auth';
import { FullPageLoading } from '../components/Loading';
import { EditShowDetailsDialog } from './EditShowDetailsDialog';
import { Breadcrumb } from '../components/Breadcrumb';
import { PodcastHero } from '../components/PodcastDetail/PodcastHero';
import { PodcastDetailsGrid } from '../components/PodcastDetail/PodcastDetailsGrid';
import { RssFeedCard } from '../components/PodcastDetail/RssFeedCard';
import { ExportsSection } from '../components/Exports/ExportsSection';
import { CollaboratorsSection } from '../components/Collaborators/CollaboratorsSection';
import { SubscriberTokensSection } from '../components/SubscriberTokens/SubscriberTokensSection';
import sharedStyles from '../components/PodcastDetail/shared.module.css';
import localStyles from './PodcastDetail.module.css';

const styles = { ...sharedStyles, ...localStyles };

export function PodcastDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: podcast, isLoading, isFetching, isError } = useQuery({
    queryKey: ['podcast', id],
    queryFn: () => getPodcast(id!),
    enabled: !!id,
  });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: me });
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', typeof window !== 'undefined' ? window.location.host : ''],
    queryFn: getPublicConfig,
    staleTime: 10_000,
  });

  const publicFeedsEnabled = publicConfig?.public_feeds_enabled !== false;
  const readOnly = isReadOnly(meData?.user);
  const myRole = (podcast as { my_role?: string } | undefined)?.my_role;
  const canManageShow = myRole === 'owner' || myRole === 'manager';

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
        <PodcastHero
          podcast={podcast}
          readOnly={readOnly}
          canManageShow={canManageShow}
          onEditClick={() => setDetailsDialogOpen(true)}
          centerTitle
        />
        <PodcastDetailsGrid podcast={podcast} publicFeedsEnabled={publicFeedsEnabled} />
      </div>

      {detailsDialogOpen && (
        <EditShowDetailsDialog
          open
          podcastId={id}
          onClose={() => setDetailsDialogOpen(false)}
        />
      )}

      <RssFeedCard podcast={podcast} />

      {canManageShow && <ExportsSection podcastId={id} readOnly={readOnly} />}

      {canManageShow && (
        <CollaboratorsSection
          podcastId={id}
          effectiveMaxCollaborators={podcast?.effective_max_collaborators ?? undefined}
        />
      )}

      {canManageShow && (
        <SubscriberTokensSection
          podcastId={id}
          podcastSlug={podcast.slug}
          readOnly={readOnly}
          subscriberOnlyFeedEnabled={podcast?.subscriber_only_feed_enabled === 1}
          effectiveMaxSubscriberTokens={podcast?.effective_max_subscriber_tokens ?? undefined}
        />
      )}
    </div>
  );
}
