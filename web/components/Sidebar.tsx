'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthUser } from '@/lib/types';

// Dark, fixed sidebar. Nav is role-aware; footer shows the signed-in user.
export function Sidebar({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const pathname = usePathname();
  const isAdmin = user.role === 'admin';

  const nav = [
    { href: '/', label: 'Dashboard', icon: GridIcon, show: true },
    { href: '/admin/', label: 'Devices', icon: KeyIcon, show: isAdmin },
    { href: '/users/', label: 'Users', icon: UsersIcon, show: isAdmin },
    { href: '/account/', label: 'Security', icon: ShieldIcon, show: true },
  ].filter((i) => i.show);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col text-slate-200 shadow-xl"
      style={{ backgroundImage: 'linear-gradient(180deg, #0a2440 0%, #0b1526 100%)' }}
    >
      <div className="flex items-center gap-3 px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Micro Maintenance" className="brand-chip h-10 w-10 p-1.5" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">Dashboard</div>
          <div className="text-xs text-slate-400">Micro Maintenance</div>
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {nav.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href.replace(/\/$/, ''));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/10 text-white shadow-[inset_3px_0_0_0_#0070c0]'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-2 truncate text-xs text-slate-400" title={user.email}>
          {user.email}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              isAdmin ? 'bg-brand-600 text-white' : 'bg-slate-600 text-slate-100'
            }`}
          >
            {isAdmin ? 'Admin' : 'Technician'}
          </span>
          {user.mfa_enabled && (
            <span className="rounded bg-green-700/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-100">
              MFA on
            </span>
          )}
        </div>
        <button
          onClick={onSignOut}
          className="w-full rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-sidebar-hover"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 21 2m-4 4 3 3m-6-1 3 3" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 8.2a3 3 0 0 1 0 5.6M21.5 20a6 6 0 0 0-4-5.7" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3z" />
    </svg>
  );
}
