import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { listMessages, type ContactMessage, type MessagesSort } from '../api/messages';
import styles from './Messages.module.css';

const LIMIT = 10;
const MESSAGE_PREVIEW_LENGTH = 300;
const SEARCH_DEBOUNCE_MS = 300;

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function truncateMessage(msg: string, maxLen: number): string {
  const s = msg.trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen).trimEnd() + '…';
}

export function Messages() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sort, setSort] = useState<MessagesSort>('newest');

  useEffect(() => {
    if (search === '') {
      setSearchDebounced('');
      setPage(1);
      return;
    }
    const id = window.setTimeout(() => {
      setSearchDebounced(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['messages', page, searchDebounced, sort],
    queryFn: () => listMessages(page, LIMIT, searchDebounced || undefined, sort),
    refetchOnMount: 'always',
  });

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
  }

  function setSortNewest() {
    setSort('newest');
    setPage(1);
  }
  function setSortOldest() {
    setSort('oldest');
    setPage(1);
  }

  const messages = data?.messages ?? [];
  const pagination = data?.pagination;

  return (
    <div className={styles.messages}>
      <div className={styles.head}>
        <h1 className={styles.title}>Messages</h1>
      </div>
      <div className={styles.bar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by name, email, or message..."
          value={search}
          onChange={handleSearchChange}
          aria-label="Search messages"
        />
        <div className={styles.sortToggle} role="group" aria-label="Sort order">
          <button
            type="button"
            className={sort === 'newest' ? styles.sortBtnActive : styles.sortBtn}
            aria-label="Sort newest first"
            onClick={setSortNewest}
          >
            <ArrowDown size={16} strokeWidth={2} aria-hidden />
            Newest
          </button>
          <button
            type="button"
            className={sort === 'oldest' ? styles.sortBtnActive : styles.sortBtn}
            aria-label="Sort oldest first"
            onClick={setSortOldest}
          >
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
            Oldest
          </button>
        </div>
      </div>
      {isLoading && <p className={styles.muted}>Loading messages...</p>}
      {isError && <p className={styles.error}>Failed to load messages.</p>}
      {!isLoading && !isError && (
        <>
          {messages.length === 0 ? (
            <div className={styles.messageCard}>
              <p className={styles.emptyCardText}>No contact messages found.</p>
            </div>
          ) : (
            <div className={styles.messageList}>
              {messages.map((msg) => (
                <MessageCard key={msg.id} message={msg} />
              ))}
            </div>
          )}
          {pagination && (
            <p className={styles.subtitleRight}>
              Showing {messages.length} of {pagination.total} messages
              {searchDebounced && ` matching "${searchDebounced}"`}
            </p>
          )}
          {pagination && pagination.totalPages > 1 && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Go to previous page"
                  >
                    Previous
                  </button>
                  <span className={styles.pageInfo}>
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    disabled={page >= pagination.totalPages}
                    aria-label="Go to next page"
                  >
                    Next
                  </button>
                </div>
              )}
        </>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: ContactMessage }) {
  const preview = truncateMessage(message.message, MESSAGE_PREVIEW_LENGTH);
  const isTruncated = message.message.trim().length > MESSAGE_PREVIEW_LENGTH;
  const contextLabel =
    message.episode_title && message.podcast_title
      ? `${message.episode_title} - ${message.podcast_title}`
      : message.podcast_title
        ? message.podcast_title
        : null;
  return (
    <div className={styles.messageCard}>
      <div className={styles.messageCardRow}>
        <h3 className={styles.messageCardName}>{message.name}</h3>
        <time className={styles.messageCardDate} dateTime={message.created_at}>
          {formatDateTime(message.created_at)}
        </time>
      </div>
      {contextLabel && (
        <p className={styles.messageCardContext}>Re: {contextLabel}</p>
      )}
      <p className={styles.messageCardEmail}>
        <a href={`mailto:${message.email}`} className={styles.emailLink}>
          {message.email}
        </a>
      </p>
      <div className={styles.messageCardBody}>
        <p className={styles.messageCardText}>
          {preview}
          {isTruncated && <span className={styles.ellipsis}> …</span>}
        </p>
      </div>
    </div>
  );
}
