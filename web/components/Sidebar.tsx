'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthUser } from '@/lib/types';

// Dark, fixed sidebar. Nav is role-aware; footer shows the signed-in user.
// Collapsible to an icons-only rail (width toggles between 15rem and 4rem).
export function Sidebar({
  user,
  onSignOut,
  collapsed,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: {
  user: AuthUser;
  onSignOut: () => void;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const isAdmin = user.role === 'admin';

  const nav = [
    { href: '/', label: 'Dashboard', icon: GridIcon, show: true },
    { href: '/devices/', label: 'Devices', icon: MonitorIcon, show: true },
    { href: '/checks/', label: 'Weekly Checks', icon: CheckIcon, show: true },
    { href: '/reports/', label: 'Reports', icon: ReportIcon, show: true },
    { href: '/admin/', label: 'Admin', icon: KeyIcon, show: isAdmin },
    { href: '/users/', label: 'Users', icon: UsersIcon, show: isAdmin },
    { href: '/account/', label: 'Security', icon: ShieldIcon, show: true },
  ].filter((i) => i.show);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex flex-col text-slate-200 shadow-xl transition-[width,transform] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      style={{ backgroundImage: 'linear-gradient(180deg, #0a2440 0%, #0b1526 100%)' }}
    >
      <div
        className={`flex items-center py-5 ${collapsed ? 'justify-center px-0' : 'gap-3 px-5'}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Micro Maintenance" className="brand-chip h-10 w-10 shrink-0 p-1.5" />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Dashboard</div>
            <div className="text-xs text-slate-400">Micro Maintenance</div>
          </div>
        )}
      </div>

      {/* Collapse / expand toggle. */}
      <button
        onClick={onToggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-expanded={!collapsed}
        className={`mb-1 hidden items-center rounded-md py-1.5 text-slate-300 transition-colors hover:bg-white/5 hover:text-white lg:flex ${
          collapsed ? 'mx-2 justify-center' : 'mx-3 justify-end px-2'
        }`}
      >
        <ChevronIcon dir={collapsed ? 'right' : 'left'} />
      </button>

      <nav className="mt-1 flex-1 space-y-1 px-3">
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
              onClick={onMobileClose}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-md py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-3'
              } ${
                active
                  ? 'bg-white/10 text-white shadow-[inset_3px_0_0_0_#0070c0]'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-white/10 py-4 ${collapsed ? 'px-2' : 'px-4'}`}>
        {!collapsed && (
          <>
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
          </>
        )}
        <button
          onClick={onSignOut}
          title="Log out"
          className={`flex items-center rounded-md border border-slate-600 text-xs font-medium text-slate-200 hover:bg-sidebar-hover ${
            collapsed ? 'w-full justify-center py-2' : 'w-full justify-center gap-2 px-3 py-1.5'
          }`}
        >
          <LogoutIcon />
          {!collapsed && 'Log out'}
        </button>
      </div>
    </aside>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
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
function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h2v4H8zM14 11h2v6h-2z" />
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
