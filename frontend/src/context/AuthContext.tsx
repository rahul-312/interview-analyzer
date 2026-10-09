'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { RegisterInput, User } from '@/models/Auth';
import { authService } from '@/services/AuthService';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
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

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>;
};
