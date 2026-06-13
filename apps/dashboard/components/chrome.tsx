"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Archive, Eye, FolderKanban, History, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

interface DashboardChromeProps {
  title: string;
  subtitle?: string;
  refreshing: boolean;
  lastLoadedAt: Date | null;
  onRefresh: () => void;
  children: ReactNode;
}

const navItems = [
  { href: "/", label: "Control", icon: Activity },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/review", label: "Review", icon: Eye },
  { href: "/back-burner", label: "Back Burner", icon: Archive },
  { href: "/runs", label: "Runs", icon: History }
];

export function DashboardChrome({
  title,
  subtitle,
  refreshing,
  lastLoadedAt,
  onRefresh,
  children
}: DashboardChromeProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh w-full bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-moss">Arcadia</p>
            <h1 className="truncate text-xl font-semibold leading-7">{title}</h1>
            {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            title="Refresh snapshot"
            aria-label="Refresh snapshot"
            onClick={onRefresh}
            disabled={refreshing}
            className="grid h-11 w-11 place-items-center rounded-md border border-line bg-panel text-ink shadow-soft transition hover:border-steel hover:text-steel disabled:opacity-60"
          >
            <RefreshCw className={refreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"} aria-hidden="true" />
          </button>
        </div>
        <nav className="mx-auto grid max-w-6xl grid-cols-5 border-t border-line px-2 sm:px-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex min-h-12 items-center justify-center gap-2 border-b-2 px-2 text-sm font-medium ${
                  active
                    ? "border-moss text-moss"
                    : "border-transparent text-muted transition hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-5 pb-20 sm:py-7">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-6 text-xs text-muted">
        {lastLoadedAt ? `Updated ${formatClock(lastLoadedAt)}` : "Waiting for Arcadia"}
      </footer>
    </div>
  );
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
