import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";

import { useAuth } from "../lib/auth";
import { isDesktop } from "../lib/desktop";
import { Avatar, Logo, cx } from "./ui";

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

function NavItem({ to, icon: Icon, label, end }: NavEntry) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 h-9 px-3 rounded-xl text-[13.5px] font-medium transition-colors",
          isActive ? "bg-surface text-ink shadow-soft border border-line" : "text-ink-2 hover:bg-sunken hover:text-ink border border-transparent",
        )
      }
    >
      <Icon className="size-[17px]" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

/** Sidebar layout shared by the client dashboard and the master admin portal. */
export function Shell({ nav, badge, home, footer, children }: { nav: NavEntry[]; badge: ReactNode; home: string; footer?: ReactNode; children?: ReactNode }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex flex-col h-full" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
      <div className={cx("px-5 h-16 flex items-center gap-2.5", isDesktop && "pt-6")}>
        <Link to={home}><Logo /></Link>
        {badge}
      </div>
      <nav className="mt-3 px-3 space-y-0.5 flex-1 overflow-y-auto">
        {nav.map((n) => <NavItem key={n.to} {...n} />)}
      </nav>
      {footer}
      <div className="p-3 border-t border-line">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Avatar name={user?.name || user?.email || "?"} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium truncate">{user?.client?.name ?? user?.name ?? "Admin"}</div>
            <div className="text-[12px] text-ink-3 truncate">{user?.email}</div>
          </div>
          <button onClick={() => signOut()} className="size-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:block sticky top-0 h-dvh border-r border-line bg-canvas/80 backdrop-blur" style={isDesktop ? ({ WebkitAppRegion: "drag" } as any) : undefined}>
        <div className="h-full" style={isDesktop ? ({ WebkitAppRegion: "no-drag" } as any) : undefined}>{sidebar}</div>
      </aside>
      <div className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between border-b border-line bg-canvas/85 backdrop-blur">
        <Link to={home}><Logo /></Link>
        <button onClick={() => setOpen(true)} className="size-9 rounded-xl flex items-center justify-center hover:bg-sunken" aria-label="Menu"><Menu className="size-5" /></button>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[#1d1d1f]/25" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-canvas border-r border-line animate-fade-in">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 size-8 rounded-lg flex items-center justify-center hover:bg-sunken" aria-label="Close menu"><X className="size-4" /></button>
            {sidebar}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 sm:px-8 py-8 lg:py-10 max-w-[1240px] w-full mx-auto">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
