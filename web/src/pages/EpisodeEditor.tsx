import { useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getEpisode } from '../api/episodes';
import { getPodcast } from '../api/podcasts';
import { listSegments, type EpisodeSegment } from '../api/segments';
import { getAsrAvailable } from '../api/asr';
import { FullPageLoading } from '../components/Loading';
import { EpisodeEditorContent } from './EpisodeEditor/EpisodeEditorContent';
import styles from './EpisodeEditor.module.css';

export function EpisodeEditor() {
  const { id } = useParams<{ id: string }>();
  const { data: episode, isLoading, isFetching, isError } = useQuery({
    queryKey: ['episode', id],
    queryFn: () => getEpisode(id!),
    enabled: !!id,
  });
  const { data: podcast } = useQuery({
    queryKey: ['podcast', episode?.podcast_id],
    queryFn: () => getPodcast(episode!.podcast_id),
    enabled: !!episode?.podcast_id,
  });
  const { data: segmentsData, isLoading: segmentsLoading } = useQuery({
    queryKey: ['segments', id],
    queryFn: () => listSegments(id!),
    enabled: !!id,
  });
  const emptySegmentsRef = useRef<EpisodeSegment[]>([]);
  const segments = useMemo(
    () => segmentsData?.segments ?? emptySegmentsRef.current,
    [segmentsData?.segments]
  );
  const { data: asrAvail } = useQuery({
    queryKey: ['asrAvailable'],
    queryFn: getAsrAvailable,
    enabled: !!id,
    staleTime: 30_000,
    retry: false,
  });

  if (!id) return null;
  if (isLoading || (!episode && isFetching)) return <FullPageLoading />;
  if (isError || !episode) return <p className={styles.error}>Episode not found.</p>;

  return (
    <EpisodeEditorContent
      episode={episode}
      podcast={podcast}
      segments={segments}
      segmentsLoading={segmentsLoading}
      asrAvail={asrAvail}
    />
  );
}

