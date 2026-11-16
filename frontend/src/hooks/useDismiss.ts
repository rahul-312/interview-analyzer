'use client';

import { RefObject, useEffect } from 'react';

type Ref = RefObject<HTMLElement | null>;

/**
 * While `open`, calls `onDismiss` on a click outside `ref` or on Escape. For dropdown menus.
 * Pass several refs when part of the menu is rendered elsewhere (e.g. in a portal).
 */
export function useDismiss(ref: Ref | Ref[], open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const refs = Array.isArray(ref) ? ref : [ref];
    const onClick = (e: MouseEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onDismiss]);
}
