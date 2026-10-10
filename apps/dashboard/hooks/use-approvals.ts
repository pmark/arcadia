"use client";

import { useCallback, useEffect, useState } from "react";
import type { Approval, ApprovalList } from "../lib/approvals";

export interface Choice {
  /** The action button's own label, shown while pending. */
  label: string;
  /** For kind "agent_ask": the settlement disposition to send. */
  disposition?: "accepted" | "rejected";
  /** For kind "decision": the option label to answer with. */
  option?: string;
  /** For a build-packet review item: approve or reject it through /api/review-action. Approve never executes. */
  reviewAction?: "approve" | "reject";
}

/** The request one choice sends: a build packet goes to /api/review-action with noExecute, everything else to /api/approvals. */
export function requestFor(approval: Approval, choice: Choice): { url: string; body: Record<string, unknown> } {
  if (approval.kind === "review_item" && choice.reviewAction) {
    return {
      url: "/api/review-action",
      body: {
        id: approval.id,
        action: choice.reviewAction,
        ...(choice.reviewAction === "approve" ? { noExecute: true } : {})
      }
    };
  }
  return {
    url: "/api/approvals",
    body: {
      kind: approval.kind,
      id: approval.id,
      project: approval.project,
      disposition: choice.disposition,
      option: choice.option
    }
  };
}

// Not a hook value: guards one page's poll against an earlier response
// overwriting a later one, the same pattern the Operator actions section uses.
let approvalRefreshSequence = 0;

export const APPROVAL_POLL_MS = 15_000;

export function cardKey(approval: Approval): string {
  // Decision ids are per-repository sequences ("0001", "0002", …), so two
  // Projects can share one — include the Project to keep cards and pending
  // state distinct across them.
  return `${approval.kind}:${approval.project}:${approval.id}`;
}

/**
 * Loads GET /api/approvals, polls it every 15 seconds while `enabled`, and
 * settles an item through POST /api/approvals. Shared by the /runs queue and
 * the /todo pages so both read and write the same list the same way.
 */
export function useApprovals({ enabled = true, refreshSignal = 0 }: { enabled?: boolean; refreshSignal?: number } = {}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState<ApprovalList["source"] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const requested = ++approvalRefreshSequence;
    await fetch("/api/approvals", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as Partial<ApprovalList> & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load pending approvals.");
        if (requested === approvalRefreshSequence) {
          setApprovals(body.approvals ?? []);
          setNote(body.note ?? null);
          setSource(body.source ?? null);
          setError(null);
          setHasLoaded(true);
        }
      })
      .catch((err) => {
        if (requested === approvalRefreshSequence) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    const interval = setInterval(() => void refresh(), APPROVAL_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, refresh, refreshSignal]);

  const act = useCallback(async (approval: Approval, choice: Choice) => {
    const key = `${cardKey(approval)}:${choice.label}`;
    setPendingId(key);
    setMessage(null);
    setError(null);
    try {
      const request = requestFor(approval, choice);
      const response = await fetch(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body)
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not apply this approval.");
      setMessage(body.message ?? "Applied.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }, [refresh]);

  return { approvals, error, note, source, pendingId, message, hasLoaded, refresh, act };
}
