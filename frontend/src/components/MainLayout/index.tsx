'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/router';
import { Plus } from 'lucide-react';
import Navbar from '../Navbar';
import Sidebar from '../Navbar/Sidebar';
import Button from '../ui/Button';
import { openRoutes, publicRoutes } from '@/config/navItems';
import { useAuth } from '@/context/AuthContext';
import { DialogsProvider } from '@/context/DialogsContext';
import { useAddApplication } from '@/hooks/useAddApplication';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';

interface LayoutProps {
  children: ReactNode;
}

/** Floating "+" button for mobile, where the navbar button is in the menu. */
const AddApplicationFab = () => {
  const addApplication = useAddApplication();
  return (
    <Button
      onClick={addApplication}
      aria-label="Add application"
      className="fixed right-6xl bottom-6xl z-40 flex h-fab w-fab items-center justify-center rounded-2xl bg-brand text-white shadow-lg hover:bg-brand-dark md:hidden"
    >
      <Plus size={28} />
    </Button>
  );
};

const MainLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();
  const isPublic = publicRoutes.includes(router.pathname);
  const isOpen = openRoutes.includes(router.pathname);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Send logged-out users to the login page
  useEffect(() => {
    if (ready && !user && !isPublic && !isOpen) router.replace('/login');
  }, [ready, user, isPublic, isOpen, router]);

  // Public pages render without the navbar, and have their own <main>
  if (isPublic || (isOpen && !user)) return <>{children}</>;

  if (!ready || !user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-medium-gray">Loading…</div>;
  }

  return (
    <DialogsProvider>
      <div
        className={`min-h-screen pb-20xl transition-[padding] duration-300 ease-in-out motion-reduce:transition-none ${
          sidebarCollapsed ? 'md:pl-sidebar-collapsed' : 'md:pl-sidebar'
        }`}
      >
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

        {/* Top bar */}
        <div
          className={`sticky top-0 z-30 rounded-b-3xl transition-[background-color,box-shadow] before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:backdrop-blur-xl ${
            isScrolled ? 'bg-white/40 shadow-card' : ''
          }`}
        >
          <Navbar />
        </div>

        {/* Page content */}
        <main className="mx-auto max-w-page px-4xl pt-lg pb-8xl md:px-12xl">{children}</main>

        <AddApplicationFab />
      </div>
    </DialogsProvider>
  );
};

export default MainLayout;
