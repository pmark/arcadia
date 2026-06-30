"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";
import type { AdminSubmission } from "../lib/intelligence-types";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export function useIntelligenceJob(initialJobId: string | null) {
  const [job, setJob] = useState<IntelligenceJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const pollStartRef = useRef<number | null>(null);

  const loadJob = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/admin-intelligence/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { job?: IntelligenceJob; error?: string };
      if (!response.ok || !body.job) {
        throw new Error(body.error ?? "Failed to load job.");
      }
      setJob(body.job);
      setError(null);
      return body.job;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (initialJobId) {
      void loadJob(initialJobId);
    }
  }, [initialJobId, loadJob]);

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.has(job.status)) {
      pollStartRef.current = null;
      return;
    }
    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }
    if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
      setPollingStopped(true);
      return;
    }
    const timer = setTimeout(() => void loadJob(job.id), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [job, loadJob]);

  const submit = useCallback(
    async (submission: AdminSubmission) => {
      if (submitting) {
        return;
      }
      setSubmitting(true);
      setError(null);
      setPollingStopped(false);
      pollStartRef.current = null;
      try {
        const response = await fetch("/api/admin-intelligence/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
        const body = (await response.json()) as { job?: IntelligenceJob; error?: string };
        if (!response.ok || !body.job) {
          throw new Error(body.error ?? "Submission failed.");
        }
        setJob(body.job);
        return body.job;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting],
  );

  return { job, submit, submitting, error, pollingStopped, refresh: () => job && loadJob(job.id) };
}
