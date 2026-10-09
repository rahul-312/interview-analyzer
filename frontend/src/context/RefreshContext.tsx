'use client';

import { createContext, useContext } from 'react';

interface RefreshState {
  key: number;
  bump: () => void;
}

/** A shared counter. Bumping it makes every useApi hook refetch (used after saves in dialogs). */
export const RefreshContext = createContext<RefreshState>({ key: 0, bump: () => {} });

export const useRefresh = () => useContext(RefreshContext);
