"use client";

import { Eye, MessageSquarePlus, Radar } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/capture", label: "Capture", icon: MessageSquarePlus },
  { href: "/mission-control", label: "Mission Control", icon: Radar },
  { href: "/review", label: "Decisions", icon: Eye }
];

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh w-full min-w-0 bg-canvas text-ink">
      <main className="mx-auto w-full min-w-0 max-w-lg px-4 pb-24 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-3 pb-[env(safe-area-inset-bottom)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition ${
                  active ? "text-moss" : "text-muted"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
