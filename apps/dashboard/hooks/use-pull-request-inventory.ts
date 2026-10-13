"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardOutstandingPullRequests } from "../lib/types";
import { createInventoryRequestCoordinator } from "../lib/pull-request-inventory-client";

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
  const [requestCoordinator] = useState(() => createInventoryRequestCoordinator());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollWake = useRef<(() => void) | null>(null);
  const runGeneration = useRef(0);
  const mounted = useRef(true);

  const request = useCallback(async (refresh: boolean, pollsRemaining = MAX_REFRESH_POLLS): Promise<void> => {
    const generation = ++runGeneration.current;
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    pollWake.current?.();
    pollWake.current = null;
    setState((current) => ({ ...current, refreshing: refresh || current.refreshing }));

    let nextRefresh = refresh;
    let remaining = pollsRemaining;
    while (mounted.current && generation === runGeneration.current) {
      const result = await requestCoordinator.request(nextRefresh);
      if (!mounted.current || generation !== runGeneration.current || result.status === "superseded") return;

      if (result.status === "success") {
        const inventory = result.inventory;
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

        if (!inventory.refreshing) return;
        if (remaining === 0) {
          setState((current) => ({
            ...current,
            refreshing: false,
            stale: true,
            error: "The inventory refresh is taking longer than one minute. Prior cards remain available; try again when ready."
          }));
          return;
        }
        await new Promise<void>((resolve) => {
          pollWake.current = resolve;
          pollTimer.current = setTimeout(resolve, POLL_INTERVAL_MS);
        });
        pollTimer.current = null;
        pollWake.current = null;
        nextRefresh = false;
        remaining -= 1;
      } else {
        setState((current) => ({
          ...current,
          error: result.message,
          loading: false,
          refreshing: false,
          stale: current.data !== null,
          incomplete: current.incomplete,
          retainedProjectIds: current.retainedProjectIds
        }));
        return;
      }
    }
  }, [requestCoordinator]);

  useEffect(() => {
    mounted.current = true;
    void request(true);
    return () => {
      mounted.current = false;
      runGeneration.current += 1;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollWake.current?.();
      requestCoordinator.cancel();
    };
  }, [request, requestCoordinator]);

  const refresh = useCallback(() => request(true), [request]);
  return { ...state, refresh };
}
