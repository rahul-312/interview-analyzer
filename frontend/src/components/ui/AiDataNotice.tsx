"use client";

import { useUsage } from "@/hooks/useUsage";

/**
 * Tells people where their text goes before they send it: with AI on, debriefs and job
 * descriptions go to Google's Gemini API. Nothing is shown with AI off (it all stays on the server).
 */
export default function AiDataNotice({ what }: { what: string }) {
  const { usage } = useUsage();
  if (!usage?.ai_enabled) return null;
  return (
    <p className="text-xs text-medium-gray">
      AI analysis is on: {what} is sent to Google&apos;s Gemini API. On Gemini&apos;s free tier, Google may use it to
      improve its products, and people may review it, so leave out anything you wouldn&apos;t want shared.
    </p>
  );
}
