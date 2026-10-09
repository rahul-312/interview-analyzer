'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';

/** The user's plan and analyses left, from the shared auth state (no extra requests). */
export function useUsage() {
  const { user, refreshUser } = useAuth();
  return { usage: user?.usage ?? null, reloadUsage: refreshUser };
}

/**
 * Refreshes usage when background analyses finish (`busy` goes from true to false),
 * so a refunded analysis shows up in the count straight away.
 */
export function useRefreshUsageWhenDone(busy: boolean) {
  const { reloadUsage } = useUsage();
  const wasBusy = useRef(busy);

  useEffect(() => {
    if (wasBusy.current && !busy) reloadUsage();
    wasBusy.current = busy;
  }, [busy, reloadUsage]);
}
