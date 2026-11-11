'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { PrepResource } from '@/models/PrepPlan';

interface ResourceListProps {
  resources: PrepResource[];
}

/** The link's site ("sqlbolt.com"), or null if it isn't a plain web link (the server checks too). */
const siteOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** The plan's top resources to prepare from, best first, each showing which site it opens. */
const ResourceList: React.FC<ResourceListProps> = ({ resources }) => {
  const links = resources.flatMap((r) => {
    const site = siteOf(r.url);
    return site ? [{ ...r, site }] : [];
  });
  if (!links.length) return null;

  return (
    <div>
      <p className="mb-md text-xs font-semibold tracking-wide text-medium-gray uppercase">Top resources to prepare from</p>
      <ol className="flex flex-col gap-lg">
        {links.map((r, i) => (
          <li key={r.url} className="flex gap-2xl rounded-lg border border-light-gray p-2xl">
            <span className="w-4xl shrink-0 text-sm font-semibold text-primary">{i + 1}</span>
            <span className="min-w-0">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-sm text-sm font-medium text-primary hover:underline"
              >
                {r.title} <ExternalLink size={14} className="shrink-0" />
              </a>
              <span className="mt-xs flex flex-wrap items-center gap-md text-xs text-medium-gray">
                <span className="break-all">{r.site}</span>
                <span className="rounded-full bg-smoke-white px-md py-xs capitalize">{r.kind}</span>
                {r.source === 'ai' && <span className="rounded-full bg-primary-light px-md py-xs text-primary-dark">AI-suggested</span>}
              </span>
              {r.why && <span className="mt-xs block text-sm text-medium-gray">{r.why}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default ResourceList;
