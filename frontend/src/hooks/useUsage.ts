'use client';

import { useApi } from './useApi';
import { authService } from '@/services/AuthService';

/** The user's plan and analyses left today. Refetches whenever a dialog saves something. */
export function useUsage() {
  const { data, reload } = useApi('usage', () => authService.me());
  return { usage: data?.usage ?? null, reloadUsage: reload };
}
