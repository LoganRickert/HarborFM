export type PodrollFormItem = {
  feedGuid: string;
  feedUrl: string;
  title: string;
  coverArtUrl: string;
  homeUrl: string;
};

export function emptyPodrollItem(): PodrollFormItem {
  return { feedGuid: '', feedUrl: '', title: '', coverArtUrl: '', homeUrl: '' };
}
