'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefresh } from '@/context/RefreshContext';
import { errorText } from '@/utils/errorText';

/**
 * Loads data with `fetcher`. Refetches when `key` or the shared refresh key changes,
 * skips loading while `key` is null, and polls every 2 seconds while `pollWhile(data)` is true.
 */
export function useApi<T>(key: string | null, fetcher: () => Promise<T>, pollWhile?: (data: T) => boolean) {
  const { key: refreshKey } = useRefresh();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [tick, setTick] = useState(0);

  // Keep the latest callbacks without refetching when they change identity.
  const fetcherRef = useRef(fetcher);
  const pollRef = useRef(pollWhile);
  useEffect(() => {
    fetcherRef.current = fetcher;
    pollRef.current = pollWhile;
  });

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        if (pollRef.current?.(result)) timer = setTimeout(load, 2000);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, refreshKey, tick]);

  return { data, error, loading, reload, setData };
}
