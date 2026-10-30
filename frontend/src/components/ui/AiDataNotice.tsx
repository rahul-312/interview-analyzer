'use client';

import React from 'react';
import Link from 'next/link';
import { useUsage } from '@/hooks/useUsage';

interface AiDataNoticeProps {
  /** What gets sent, e.g. "your debrief, with the job's description". */
  what: string;
}

/**
 * Tells people where their text goes before they send it: with AI on, to Google's Gemini API.
 * On Gemini's free tier Google may also use it, so that's said too. On the Free plan, debriefs may
 * be used for training, which is always said (the server decides both, per plan).
 */
const AiDataNotice: React.FC<AiDataNoticeProps> = ({ what }) => {
  const { usage } = useUsage();
  if (!usage) return null;
  if (!usage.ai_enabled && !usage.training_notice) return null;
  return (
    <p className="text-xs text-medium-gray">
      {usage.ai_enabled && <>AI analysis is on: {what} is sent to Google&apos;s Gemini API. </>}
      {usage.ai_free_tier &&
        "On Gemini's free tier, Google may use it to improve its products, and people may review it, so leave out anything you wouldn't want shared. "}
      {usage.training_notice && (
        <>
          On the Free plan, your debriefs may be used to train and improve the AI.{' '}
          <Link href="/pricing" className="font-medium text-primary hover:underline">
            Pro and Pro Plus
          </Link>{' '}
          debriefs never are.
        </>
      )}
    </p>
  );
};

export default AiDataNotice;
