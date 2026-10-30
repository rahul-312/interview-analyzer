'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import Logo from '../Logo';
import NavLinks from './NavLinks';
import PlanCard from './PlanCard';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Desktop sidebar: logo, page links and the plan card. Collapses to an icon rail.
 * Mobile uses the hamburger menu instead.
 */
const Sidebar = ({ collapsed, onToggle }: SidebarProps) => (
  <aside
    className={`fixed inset-y-0 left-0 z-40 hidden flex-col gap-12xl glass rounded-none border-y-0! border-l-0! px-4xl py-8xl transition-[width] duration-300 ease-in-out md:flex ${
      collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
    }`}
  >
    <div className="px-sm">
      <Logo compact={collapsed} />
    </div>
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="absolute top-12xl -right-2xl flex h-8xl w-8xl items-center justify-center rounded-full border border-white/70 bg-white text-dark-gray shadow-card transition-colors hover:text-ink"
    >
      {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
    </button>
    <nav aria-label="Main">
      <NavLinks compact={collapsed} />
    </nav>
    {/* Fixed width so the card fades out instead of reflowing as the sidebar narrows */}
    <div
      className={`mt-auto w-[calc(var(--spacing-sidebar)-2*var(--spacing-4xl))] transition-[opacity,visibility] duration-300 ease-in-out ${
        collapsed ? 'invisible opacity-0' : 'opacity-100'
      }`}
    >
      <PlanCard />
    </div>
  </aside>
);

export default Sidebar;
