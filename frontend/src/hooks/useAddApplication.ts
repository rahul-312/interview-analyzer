'use client';

import { useRouter } from 'next/router';
import { useDialogs } from '@/context/DialogsContext';

/**
 * Opens the "+ Add application" pop-up. What happens after saving depends on the current tab:
 * Applications opens the new application, Interviews logs a round for it, Analysis opens the
 * debrief, and Prep starts a new plan.
 */
export function useAddApplication() {
  const router = useRouter();
  const { openAddApplication, openRoundForm } = useDialogs();

  return () =>
    openAddApplication({
      afterCreate: (app) => {
        const path = router.pathname;
        if (path.startsWith('/interviews')) {
          openRoundForm({ applicationId: app.id });
        } else if (path.startsWith('/analysis')) {
          openRoundForm({
            applicationId: app.id,
            withDebrief: true,
            afterSave: (round) => router.push(`/interviews/${round.id}`),
          });
        } else if (path.startsWith('/prep')) {
          router.push(`/prep?new=${app.id}`);
        } else {
          router.push(`/applications/${app.id}`);
        }
      },
    });
}
