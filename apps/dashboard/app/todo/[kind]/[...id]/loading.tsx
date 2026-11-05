"use client";

import { useParams } from "next/navigation";
import { Activity } from "../../../../components/decision-answer";
import { MobileShell } from "../../../../components/mobile-shell";

/** Shown at once on a tap: the shell and what's opening, before the page's own script has arrived. */
export default function Loading() {
  const params = useParams<{ kind?: string }>();
  const decision = params?.kind === "decision";
  const shell = <MobileShell deferMenuData><Activity>{decision ? "Opening this Decision..." : "Opening this to-do..."}</Activity></MobileShell>;
  return decision ? <div data-theme-scope="auto">{shell}</div> : shell;
}
