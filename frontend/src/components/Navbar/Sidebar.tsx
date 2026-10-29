'use client';

import Logo from '../Logo';
import NavLinks from './NavLinks';
import PlanCard from './PlanCard';

/** Desktop sidebar: logo, page links and the plan card. Mobile uses the hamburger menu instead. */
const Sidebar = () => (
  <aside className="fixed inset-y-0 left-0 z-40 hidden w-sidebar flex-col gap-12xl glass rounded-none border-y-0 border-l-0 px-4xl py-8xl md:flex">
    <div className="px-sm">
      <Logo />
    </div>
    <nav aria-label="Main">
      <NavLinks />
    </nav>
    <div className="mt-auto">
      <PlanCard />
    </div>
  </aside>
);

export default Sidebar;
