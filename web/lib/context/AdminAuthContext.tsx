'use client';

/**
 * Client view of the signed-in admin (spec §9.2 item 6). The session itself is an httpOnly cookie the
 * browser cannot read; this context asks the server who the caller is (/api/admin/auth/me).
 */
import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export interface SignedInAdmin {
  adminId: string;
  adminName: string;
  isOwner: boolean;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  admin: SignedInAdmin | null;
  /** Re-reads the session after a successful sign-in. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Always null: kept so older admin pages that spread it into a header keep compiling. */
  token: string | null;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

async function fetchMe(): Promise<SignedInAdmin | null> {
  try {
    const res = await fetch('/api/admin/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data ?? null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<SignedInAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setAdmin(await fetchMe());
  }, []);

  useEffect(() => {
    // Sessions used to be a bearer token in localStorage; drop any leftover copy.
    try {
      localStorage.removeItem('admin_token');
    } catch {
      // storage unavailable
    }
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      setAdmin(null);
    }
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{ isAuthenticated: admin !== null, isLoading, admin, refresh, logout, token: null }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return context;
}
