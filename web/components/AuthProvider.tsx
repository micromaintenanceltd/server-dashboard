'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchMe, getToken, clearToken } from '@/lib/api';
import type { AuthUser } from '@/lib/types';
import { Sidebar } from './Sidebar';
import { ClientLogosProvider } from './ClientLogosProvider';

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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useIsDesktop();

  // When a newer version has been deployed, reload at the next navigation so an
  // open tab stops serving stale UI (what caused "it goes back to bars").
  const stale = useAppVersionStale();
  const staleRef = useRef(false);
  useEffect(() => {
    staleRef.current = stale;
  }, [stale]);

  // Restore the saved collapse preference (per browser) after mount.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('mml_sidebar_collapsed') === '1');
    } catch {}
  }, []);

  // Close the mobile drawer whenever the route changes; and if a new version is
  // live, hard-reload at this navigation boundary to pick up the new bundle.
  useEffect(() => {
    setMobileOpen(false);
    if (staleRef.current) window.location.reload();
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('mml_sidebar_collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  if (loading) return <Splash>Loading...</Splash>;
  if (pathname === '/login') return <>{children}</>;
  if (!user) return <Splash>Redirecting to sign in...</Splash>;

  // On phones/tablets the sidebar is a slide-in drawer (always full width when
  // open); the collapse-to-icons preference only applies on desktop (lg+).
  const effectiveCollapsed = isDesktop ? collapsed : false;

  return (
    <ClientLogosProvider>
      {/* Backdrop behind the mobile drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        user={user}
        onSignOut={signOut}
        collapsed={effectiveCollapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={`min-h-screen transition-[margin] duration-200 ml-0 ${
          collapsed ? 'lg:ml-16' : 'lg:ml-60'
        }`}
      >
        {/* Mobile top bar with the menu button (hidden on desktop). */}
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <MenuIcon />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="brand-chip h-7 w-7 p-1" />
          <span className="text-sm font-semibold text-slate-800">Dashboard</span>
        </header>

        <main>{children}</main>
      </div>
    </ClientLogosProvider>
  );
}

// Polls /version.txt (written at build time with the deploy commit) and returns
// true once it differs from the version baked into this bundle — i.e. a newer
// deploy is live. Disabled locally (version 'dev'); never loops, because after a
// reload the bundle's version matches version.txt again.
function useAppVersionStale() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const baked = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
    if (!baked || baked === 'dev') return;
    let active = true;
    const check = async () => {
      try {
        const r = await fetch(`/version.txt?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const v = (await r.text()).trim();
        // Ignore an unstamped 'dev' file so a mis-set build can't loop reloads.
        if (active && v && v !== 'dev' && v !== baked) setStale(true);
      } catch {
        /* offline / transient — ignore */
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  return stale;
}

// True on desktop (lg: ≥1024px). Drives whether the sidebar is a fixed rail or a
// slide-in drawer.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      {children}
    </div>
  );
}
