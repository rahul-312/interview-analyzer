'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/router';
import { Plus } from 'lucide-react';
import Navbar from '../Navbar';
import Button from '../ui/Button';
import { publicRoutes } from '@/config/navItems';
import { useAuth } from '@/context/AuthContext';
import { DialogsProvider } from '@/context/DialogsContext';
import { useAddApplication } from '@/hooks/useAddApplication';

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
      className="fixed right-6xl bottom-6xl z-40 flex h-fab w-fab items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-dark md:hidden"
    >
      <Plus size={28} />
    </Button>
  );
};

const MainLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const isPublic = publicRoutes.includes(router.pathname);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Send logged-out users to the login page
  useEffect(() => {
    if (ready && !user && !isPublic) router.replace('/login');
  }, [ready, user, isPublic, router]);

  // Login and register render without the navbar
  if (isPublic) return <main>{children}</main>;

  if (!ready || !user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-medium-gray">Loading…</div>;
  }

  return (
    <DialogsProvider>
      <div className="min-h-screen pb-20xl">
        {/* Navbar */}
        <div
          className={`sticky top-0 z-40 border-b border-light-gray bg-white transition-shadow ${
            isScrolled ? 'shadow-md' : ''
          }`}
        >
          <Navbar />
        </div>

        {/* Page content */}
        <main className="mx-auto max-w-content px-4xl py-8xl">{children}</main>

        <AddApplicationFab />
      </div>
    </DialogsProvider>
  );
};

export default MainLayout;
