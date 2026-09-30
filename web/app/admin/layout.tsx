'use client';

/**
 * Root of every /admin URL, including /admin/login. It only provides the client auth context
 * (the login form needs it); it guards nothing. The session check lives one level down in
 * app/admin/(protected)/layout.tsx, a SERVER layout that wraps every admin page except login.
 */
import { AdminAuthProvider } from '@/lib/context/AdminAuthContext';

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminAuthProvider>{children}</AdminAuthProvider>;
}
