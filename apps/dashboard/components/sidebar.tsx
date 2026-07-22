"use client";

import { AlertTriangle, Clock, Eye, LayoutGrid, Menu, MessageSquarePlus, Radar, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MissionControlOverview } from "../lib/mission-control-types";

const PRIMARY_NAV = [
  { href: "/mission-control", label: "Mission Control", icon: Radar },
  { href: "/capture", label: "Capture", icon: MessageSquarePlus },
  { href: "/review", label: "Decisions", icon: Eye },
  { href: "/dashboard", label: "Full Dashboard", icon: LayoutGrid }
];

/**
 * Replaces the old bottom tab bar (see git history for MobileShell) with a
 * collapsible left sidebar: primary navigation on top, then dynamic,
 * contextually relevant sections below — Urgent (needsYouNow) and Recent
 * (recentlyUpdated), both real data from the same Mission Control overview
 * the default view itself uses. Deliberately a rough canvas for now, not a
 * finished IA — easy to add/reorder sections here later.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<MissionControlOverview | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch("/api/mission-control", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (!body?.error) {
          setOverview(body as MissionControlOverview);
        }
      })
      .catch(() => {
        // Sidebar's contextual sections are a bonus, not critical — a
        // failed fetch just means Urgent/Recent stay empty, no error UI.
      });
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-line/50"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && mounted
        ? createPortal(
            // Portaled to document.body rather than rendered in place: the
            // header this button lives in uses backdrop-blur, and
            // backdrop-filter (like filter/transform) creates a new
            // containing block for `position: fixed` descendants in CSS —
            // so without the portal, this drawer sizes itself against the
            // 56px-tall header instead of the viewport.
            <div className="fixed inset-0 z-40 flex">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="absolute inset-0 bg-ink/30"
              />
              <div className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-panel px-4 py-4 shadow-soft">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-lg font-semibold text-ink">Arcadia</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close menu"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:text-ink"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <nav className="grid gap-1">
                  {PRIMARY_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                          active ? "bg-moss/10 text-moss" : "text-ink hover:bg-line/50"
                        }`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>

                {overview && overview.needsYouNow.length > 0 ? (
                  <SidebarSection icon={AlertTriangle} label="Urgent" items={overview.needsYouNow} />
                ) : null}

                {overview && overview.recentlyUpdated.length > 0 ? (
                  <SidebarSection icon={Clock} label="Recent" items={overview.recentlyUpdated} />
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function SidebarSection({
  icon: Icon,
  label,
  items
}: {
  icon: LucideIcon;
  label: string;
  items: MissionControlOverview["needsYouNow"];
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 grid gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/mission-control?node=${encodeURIComponent(item.id)}`}
            className="truncate rounded-md px-3 py-2 text-sm text-ink hover:bg-line/50"
          >
            {item.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
