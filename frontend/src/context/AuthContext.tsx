'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RegisterInput, User } from '@/models/Auth';
import { authService } from '@/services/AuthService';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  /** Refetches the user, including plan usage. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // Restore the session if there's a token from last time
  useEffect(() => {
    if (!authService.hasToken()) {
      setReady(true);
      return;
    }
    authService
      .me()
      .then(setUser)
      .catch(() => authService.logout())
      .finally(() => setReady(true));
  }, []);

  const refreshUser = useCallback(async () => {
    if (!authService.hasToken()) return;
    try {
      const next = await authService.me();
      // Keep the same object when nothing changed, so consumers don't re-render
      setUser((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch {
      // Keep the current user; a 401 is already handled by the API client.
    }
  }, []);

  // Out of something: refresh when the next one frees up, so buttons re-enable by themselves
  const nextAvailableAt =
    [user?.usage.analyses, user?.usage.prep_plans]
      .filter((q) => q?.remaining === 0 && q.next_available_at)
      .map((q) => q!.next_available_at as string)
      .sort()[0] ?? null;
  useEffect(() => {
    if (!nextAvailableAt) return;
    const delay = Math.max(0, new Date(nextAvailableAt).getTime() - Date.now()) + 1000;
    const timer = setTimeout(refreshUser, Math.min(delay, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [nextAvailableAt, refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    setUser(await authService.login(username, password));
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setUser(await authService.register(input));
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    window.location.href = '/login';
  }, []);

  // Stable value: consumers only re-render when the user or ready state actually changes
  const value = useMemo(
    () => ({ user, ready, login, register, logout, refreshUser }),
    [user, ready, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
