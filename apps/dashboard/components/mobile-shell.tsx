"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full min-w-0 bg-canvas text-ink">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-panel/95 px-3 backdrop-blur">
        <Sidebar />
        <span className="text-sm font-semibold text-ink">Arcadia</span>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-lg px-4 pb-10 pt-6">{children}</main>
    </div>
  );
}
