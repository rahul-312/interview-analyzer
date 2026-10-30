'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar-collapsed';

/** Whether the desktop sidebar is collapsed to icons, remembered across visits. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount so the server render and first client render match
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
