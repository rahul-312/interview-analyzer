'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { PrepResource } from '@/models/PrepPlan';

interface ResourceListProps {
  resources: PrepResource[];
}

// Only plain web links (the server checks too), so a bad value can't become a javascript: link
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/** The plan's top resources to prepare from, best first. */
const ResourceList: React.FC<ResourceListProps> = ({ resources }) => {
  const links = resources.filter((r) => isWebLink(r.url));
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
              <span className="ml-md rounded-full bg-smoke-white px-md py-xs text-xs text-medium-gray capitalize">{r.kind}</span>
              {r.why && <span className="mt-xs block text-sm text-medium-gray">{r.why}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default ResourceList;
