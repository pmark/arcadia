"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProofHeroState, ProofTargetConfig, ProofTargetListResponse, ProofTargetView } from "../lib/types";

interface ProofHeroProps {
  projectId: string;
}

export function ProofHero({ projectId }: ProofHeroProps) {
  const [data, setData] = useState<ProofTargetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingTargetId, setCheckingTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/proof`);
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body));
      setData(body as ProofTargetListResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runCheck(targetId: string) {
    setCheckingTargetId(targetId);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFromBody(body));
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setCheckingTargetId(null);
    }
  }

  if (loading && !data) {
    return <div className="h-40 animate-pulse rounded-md border border-line bg-panel" />;
  }

  if (error && !data) {
    return (
      <div className="rounded-md border border-clay bg-panel p-4 text-sm text-clay">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Demo hero unavailable
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-ink">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { hero, targets } = data;
  const style = heroStyle(hero.state);
  const primaryTarget = targets.find((view) => view.target.id === hero.primaryAction?.targetId)?.target ?? null;

  return (
    <div className="grid min-w-0 gap-4">
      <section className={`grid min-w-0 gap-3 rounded-md border p-4 shadow-soft ${style.border} ${style.bg}`}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <style.Icon className={`mt-0.5 h-6 w-6 shrink-0 ${style.text}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase tracking-wide ${style.text}`}>{style.label}</p>
              <h2 className="mt-1 break-words text-lg font-semibold leading-6">{hero.headline}</h2>
              <p className="mt-1 max-w-2xl break-words text-sm text-muted">{hero.detail}</p>
            </div>
          </div>
          {error ? <span className="text-xs text-clay">{error}</span> : null}
        </div>

        {hero.primaryAction ? (
          <div className="flex flex-wrap items-center gap-3">
            {hero.primaryAction.url ? (
              <a
                href={hero.primaryAction.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition ${style.buttonBorder} ${style.buttonBg} ${style.text}`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {hero.primaryAction.label}
              </a>
            ) : (
              <a
                href="/qa"
                className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition ${style.buttonBorder} ${style.buttonBg} ${style.text}`}
              >
                {hero.primaryAction.label}
              </a>
            )}
            {hero.primaryAction.url && primaryTarget && macOnly(primaryTarget) ? <MacOnlyNote /> : null}
          </div>
        ) : null}
      </section>

      {targets.length > 0 ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {targets.map((view) => (
            <ProofTargetCard
              key={view.target.id}
              view={view}
              checking={checkingTargetId === view.target.id}
              onCheck={() => void runCheck(view.target.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-line bg-panel px-4 py-8 text-center text-sm text-muted">
          No Stable or Candidate proof target is configured for this Project yet.
        </div>
      )}
    </div>
  );
}

function ProofTargetCard({
  view,
  checking,
  onCheck
}: {
  view: ProofTargetView;
  checking: boolean;
  onCheck: () => void;
}) {
  const { target, lastCheck } = view;
  const healthy = lastCheck?.health_state === "healthy";
  const healthLabel = !lastCheck ? "Never checked" : healthy ? "Healthy" : "Unhealthy";
  const healthClass = !lastCheck
    ? "border-line bg-canvas text-muted"
    : healthy
      ? "border-moss/30 bg-moss/10 text-moss"
      : "border-clay/30 bg-clay/10 text-clay";

  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">{target.environment}</p>
          <h3 className="mt-1 break-words text-base font-semibold">{target.label}</h3>
        </div>
        <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${healthClass}`}>
          {healthLabel}
        </span>
      </div>

      <dl className="grid gap-2 text-xs text-muted">
        <Field label="URL" value={target.url} mono />
        <Field label="Environment kind" value={target.environmentKind} />
        <Field label="Access" value={target.accessState} />
        <Field label="Source revision" value={target.sourceRevision ?? "Unknown"} mono />
        <Field label="Last verified" value={lastCheck ? lastCheck.checked_at : "Never"} />
        {lastCheck?.error_message ? <Field label="Last error" value={lastCheck.error_message} /> : null}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={target.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-3 text-xs font-semibold text-steel transition hover:border-steel"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {target.environment === "Stable" ? "Show Stable" : "Test Candidate"}
        </a>
        {macOnly(target) ? <MacOnlyNote /> : null}
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-xs font-semibold text-muted transition hover:border-steel hover:text-steel disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "Checking..." : "Check now"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="font-semibold uppercase tracking-wide">{label}</dt>
      <dd className={`min-w-0 break-words text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * A target reachable only from this Mac still gets its link — it works here —
 * but the label has to say so. Mission Control is read from a phone over the
 * LAN or Tailscale, where a loopback URL resolves to the phone itself and the
 * demo dead-ends with nothing explaining why. Saying "Mac only" next to the
 * action is the difference between an honest proof surface and one that
 * implies a demo exists wherever it happens to be read.
 */
function macOnly(target: ProofTargetConfig): boolean {
  return target.environmentKind === "local" || target.accessState === "local-only";
}

function MacOnlyNote() {
  return <span className="text-xs font-normal text-muted">Mac only — not reachable from a phone</span>;
}

function errorMessageFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "Request failed.";
  const error = "error" in body && typeof body.error === "string" ? body.error : "Request failed.";
  return error;
}

function heroStyle(state: ProofHeroState): {
  Icon: typeof CheckCircle2;
  label: string;
  border: string;
  bg: string;
  text: string;
  buttonBorder: string;
  buttonBg: string;
} {
  switch (state) {
    case "failure":
      return {
        Icon: XCircle,
        label: "Candidate failed",
        border: "border-clay/40",
        bg: "bg-clay/10",
        text: "text-clay",
        buttonBorder: "border-clay/40",
        buttonBg: "bg-panel"
      };
    case "ready_for_operator_demo":
      return {
        Icon: CheckCircle2,
        label: "Ready for your demo",
        border: "border-moss/40",
        bg: "bg-moss/10",
        text: "text-moss",
        buttonBorder: "border-moss/40",
        buttonBg: "bg-panel"
      };
    case "qa_failed":
      return {
        Icon: ShieldAlert,
        label: "QA found a problem",
        border: "border-clay/40",
        bg: "bg-clay/10",
        text: "text-clay",
        buttonBorder: "border-clay/40",
        buttonBg: "bg-panel"
      };
    case "release_decision_needed":
      return {
        Icon: HelpCircle,
        label: "Release Decision needed",
        border: "border-gold/40",
        bg: "bg-gold/10",
        text: "text-gold",
        buttonBorder: "border-gold/40",
        buttonBg: "bg-panel"
      };
    case "stable_only":
      return {
        Icon: CheckCircle2,
        label: "Stable only",
        border: "border-steel/40",
        bg: "bg-steel/10",
        text: "text-steel",
        buttonBorder: "border-steel/40",
        buttonBg: "bg-panel"
      };
    case "proof_unavailable":
    default:
      return {
        Icon: AlertTriangle,
        label: "Proof unavailable",
        border: "border-line",
        bg: "bg-canvas",
        text: "text-muted",
        buttonBorder: "border-line",
        buttonBg: "bg-panel"
      };
  }
}
