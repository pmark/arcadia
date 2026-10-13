"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardOutstandingPullRequests } from "../lib/types";
import type { PullRequestInventoryState } from "../lib/pull-request-inventory-cache";

const POLL_INTERVAL_MS = 2_000;
const MAX_REFRESH_POLLS = 30;

interface InventoryHookState {
  data: DashboardOutstandingPullRequests | null;
  checkedAt: string | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  incomplete: boolean;
  retainedProjectIds: string[];
}

const initialState: InventoryHookState = {
  data: null,
  checkedAt: null,
  error: null,
  loading: true,
  refreshing: false,
  stale: false,
  incomplete: false,
  retainedProjectIds: []
};

export function usePullRequestInventory() {
  const [state, setState] = useState<InventoryHookState>(initialState);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const request = useCallback(async (refresh: boolean, pollsRemaining = MAX_REFRESH_POLLS): Promise<void> => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setState((current) => ({ ...current, refreshing: refresh || current.refreshing }));

    try {
      const response = await fetch(`/api/pull-requests${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Outstanding pull requests are unavailable."));
      if (!mounted.current) return;

      const inventory = body as PullRequestInventoryState;
      setState({
        data: inventory.snapshot,
        checkedAt: inventory.checkedAt,
        error: inventory.refreshError,
        loading: false,
        refreshing: inventory.refreshing,
        stale: inventory.stale,
        incomplete: inventory.incomplete,
        retainedProjectIds: inventory.retainedProjectIds
      });

      if (inventory.refreshing && pollsRemaining > 0) {
        pollTimer.current = setTimeout(() => {
          void request(false, pollsRemaining - 1);
        }, POLL_INTERVAL_MS);
      } else if (inventory.refreshing) {
        setState((current) => ({
          ...current,
          refreshing: false,
          stale: true,
          error: "The inventory refresh is taking longer than one minute. Prior cards remain available; try again when ready."
        }));
      }
    } catch (requestError) {
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        error: requestError instanceof Error ? requestError.message : String(requestError),
        loading: false,
        refreshing: false,
        stale: current.data !== null,
        incomplete: current.incomplete,
        retainedProjectIds: current.retainedProjectIds
      }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void request(true);
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [request]);

  const refresh = useCallback(() => request(true), [request]);
  return { ...state, refresh };
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  return "error" in body && typeof body.error === "string" ? body.error : fallback;
}
