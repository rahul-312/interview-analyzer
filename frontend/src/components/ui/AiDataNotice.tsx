'use client';

import React from 'react';
import { useUsage } from '@/hooks/useUsage';

interface AiDataNoticeProps {
  /** What gets sent, e.g. "your debrief, with the job's description". */
  what: string;
}

/**
 * Tells people where their text goes before they send it: with AI on, to Google's Gemini API.
 * On the free tier Google may also use it, so that's said too. Nothing is shown with AI off.
 */
const AiDataNotice: React.FC<AiDataNoticeProps> = ({ what }) => {
  const { usage } = useUsage();
  if (!usage?.ai_enabled) return null;
  return (
    <p className="text-xs text-medium-gray">
      AI analysis is on: {what} is sent to Google&apos;s Gemini API.
      {usage.ai_free_tier &&
        " On Gemini's free tier, Google may use it to improve its products, and people may review it, so leave out anything you wouldn't want shared."}
    </p>
  );
};

export default AiDataNotice;
