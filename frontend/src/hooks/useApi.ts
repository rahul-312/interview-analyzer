'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefresh } from '@/context/RefreshContext';
import { errorText } from '@/utils/errorText';

/**
 * Loads data with `fetcher`. Refetches when `key` or the shared refresh key changes,
 * skips loading while `key` is null, and polls while `pollWhile(data)` is true: every 2 seconds at
 * first, slowing to every 10, since AI jobs can run for minutes.
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
    let polls = 0;

    const load = async () => {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        if (pollRef.current?.(result)) timer = setTimeout(load, Math.min(2000 * 1.5 ** polls++, 10000));
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
