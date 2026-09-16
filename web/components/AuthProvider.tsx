'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchMe, getToken, clearToken } from '@/lib/api';
import type { AuthUser } from '@/lib/types';
import { Sidebar } from './Sidebar';

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  reload: () => Promise<void>;
  signOut: () => void;
  setUser: (u: AuthUser | null) => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  reload: async () => {},
  signOut: () => {},
  setUser: () => {},
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const rawPath = usePathname();
  // trailingSlash is on, so paths arrive as e.g. "/login/". Normalise for checks.
  const pathname = rawPath !== '/' ? rawPath.replace(/\/+$/, '') : '/';
  const router = useRouter();

  const reload = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await fetchMe();
      setUser(r.user);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    router.replace('/login');
  }, [router]);

  // Any authenticated request that 401s (expired/revoked session) signs out.
  useEffect(() => {
    const onExpired = () => signOut();
    window.addEventListener('mml:auth-expired', onExpired);
    return () => window.removeEventListener('mml:auth-expired', onExpired);
  }, [signOut]);

  // Redirect rules once the session state is known.
  useEffect(() => {
    if (loading) return;
    const onLogin = pathname === '/login';
    if (!user && !onLogin) router.replace('/login');
    else if (user && onLogin) router.replace('/');
  }, [loading, user, pathname, router]);

  return (
    <Ctx.Provider value={{ user, loading, reload, signOut, setUser }}>
      <Shell loading={loading} user={user} pathname={pathname}>
        {children}
      </Shell>
    </Ctx.Provider>
  );
}

function Shell({
  loading,
  user,
  pathname,
  children,
}: {
  loading: boolean;
  user: AuthUser | null;
  pathname: string;
  children: React.ReactNode;
}) {
  const { signOut } = useAuth();
  if (loading) return <Splash>Loading...</Splash>;
  if (pathname === '/login') return <>{children}</>;
  if (!user) return <Splash>Redirecting to sign in...</Splash>;
  return (
    <>
      <Sidebar user={user} onSignOut={signOut} />
      <main className="ml-60 min-h-screen">{children}</main>
    </>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      {children}
    </div>
  );
}
