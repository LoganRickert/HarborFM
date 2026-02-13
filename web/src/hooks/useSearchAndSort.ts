import { useState, useEffect } from 'react';

const SEARCH_DEBOUNCE_MS = 300;

export function useSearchAndSort() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  // Debounce search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchDebounced('');
      return;
    }
    const id = window.setTimeout(() => {
      setSearchDebounced(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  return {
    searchQuery,
    searchDebounced,
    setSearchQuery,
    sortNewestFirst,
    setSortNewestFirst,
  };
}
