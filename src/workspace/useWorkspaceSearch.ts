import { useEffect, useState } from 'react';
import { api } from '../bridge';
import type { FileNode, SearchResult } from '../types';

export function useWorkspaceSearch(tree: FileNode[] | undefined, notify: (message: string) => void) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    let disposed = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await api.search(query.trim());
        if (!disposed) setResults(found);
      } catch (err) {
        if (!disposed) notify((err as Error).message);
      } finally {
        if (!disposed) setSearching(false);
      }
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [query, tree]);
  return { query, setQuery, results, searching };
}
