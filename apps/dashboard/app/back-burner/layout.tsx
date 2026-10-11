import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Back Burner" };

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
