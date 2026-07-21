"use client";

import { useCallback, useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { EmptyState, ErrorState, LoadingState, Section } from "../../components/dashboard-ui";
import type {
  MissionControlActionItem,
  MissionControlNodeDetail,
  MissionControlNodeSummary,
  MissionControlOverview
} from "../../lib/mission-control-types";

type UrgencyLevel = "critical" | "attention" | "quiet";

const URGENCY_CLASS: Record<UrgencyLevel, string> = {
  critical: "border-clay text-clay",
  attention: "border-gold text-gold",
  quiet: "border-line text-muted"
};

function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold ${URGENCY_CLASS[level]}`}>
      {level}
    </span>
  );
}

function ActionItemRow({ item, onSelect }: { item: MissionControlActionItem; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-panel p-3 text-left shadow-soft"
    >
      <span className="min-w-0 truncate text-sm font-medium text-ink">{item.title}</span>
      <UrgencyBadge level={item.urgency.level} />
    </button>
  );
}

function NodeSummaryRow({ node, onSelect }: { node: MissionControlNodeSummary; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-panel p-3 text-left shadow-soft"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{node.label}</span>
        <span className="block truncate text-xs text-muted">{node.statusHeadline}</span>
      </span>
      <UrgencyBadge level={node.urgency.level} />
    </button>
  );
}

interface ReplyState {
  submitting: boolean;
  echo: string | null;
  ambiguousQuestion: string | null;
  error: string | null;
}

function ContextChannelBox({ nodeId, onApplied }: { nodeId: string; onApplied: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<ReplyState>({ submitting: false, echo: null, ambiguousQuestion: null, error: null });

  const submit = useCallback(async () => {
    if (!text.trim()) return;
    setState({ submitting: true, echo: null, ambiguousQuestion: null, error: null });
    try {
      const res = await fetch(`/api/mission-control/${encodeURIComponent(nodeId)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });
      const body = await res.json();
      if (!res.ok) {
        const question = body?.details?.question;
        if (typeof question === "string") {
          setState({ submitting: false, echo: null, ambiguousQuestion: question, error: null });
        } else {
          setState({ submitting: false, echo: null, ambiguousQuestion: null, error: body?.error ?? "Could not process that reply." });
        }
        return;
      }
      setState({ submitting: false, echo: body.echo ?? "Applied.", ambiguousQuestion: null, error: null });
      setText("");
      onApplied();
    } catch (error) {
      setState({
        submitting: false,
        echo: null,
        ambiguousQuestion: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, [text, nodeId, onApplied]);

  return (
    <div className="grid gap-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Tell Arcadia what's true, ask a question, or give an update"
        rows={2}
        className="w-full min-w-0 rounded-md border border-line bg-panel p-2 text-sm text-ink"
      />
      <button
        type="button"
        onClick={submit}
        disabled={state.submitting || !text.trim()}
        className="h-9 rounded-md border border-moss bg-moss/10 text-sm font-semibold text-moss disabled:opacity-50"
      >
        {state.submitting ? "Thinking…" : "Send"}
      </button>
      {state.echo ? <p className="text-sm text-moss">✅ {state.echo}</p> : null}
      {state.ambiguousQuestion ? <p className="text-sm text-gold">❓ {state.ambiguousQuestion}</p> : null}
      {state.error ? <p className="text-sm text-clay">🚫 {state.error}</p> : null}
    </div>
  );
}

function LifeEntryActions({ nodeId, onChanged }: { nodeId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (action: "confirm" | "complete" | "drop") => {
      setBusy(action);
      try {
        await fetch(`/api/mission-control/${encodeURIComponent(nodeId)}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text:
              action === "confirm"
                ? "still true, confirm it"
                : action === "complete"
                  ? "mark it complete, it's done"
                  : "drop this, no longer relevant"
          })
        });
        onChanged();
      } finally {
        setBusy(null);
      }
    },
    [nodeId, onChanged]
  );

  return (
    <div className="flex flex-wrap gap-2">
      {(["confirm", "complete", "drop"] as const).map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => run(action)}
          disabled={busy !== null}
          className="h-8 rounded-md border border-line px-3 text-xs font-semibold capitalize text-ink disabled:opacity-50"
        >
          {busy === action ? "…" : action}
        </button>
      ))}
    </div>
  );
}

function DecisionActions({ nodeId, onChanged }: { nodeId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (action: "approve" | "reject" | "defer") => {
      setBusy(action);
      try {
        await fetch("/api/review-action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: nodeId, action })
        });
        onChanged();
      } finally {
        setBusy(null);
      }
    },
    [nodeId, onChanged]
  );

  return (
    <div className="flex flex-wrap gap-2">
      {(["approve", "reject", "defer"] as const).map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => run(action)}
          disabled={busy !== null}
          className="h-8 rounded-md border border-line px-3 text-xs font-semibold capitalize text-ink disabled:opacity-50"
        >
          {busy === action ? "…" : action}
        </button>
      ))}
    </div>
  );
}

function NodeDetailPanel({
  detail,
  onSelect,
  onBack,
  onChanged
}: {
  detail: MissionControlNodeDetail;
  onSelect: (id: string) => void;
  onBack: (() => void) | null;
  onChanged: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-xs font-semibold text-steel">
            ← Back
          </button>
        ) : (
          <span />
        )}
        <UrgencyBadge level={detail.urgency.level} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">{detail.label}</h3>
        <p className="text-sm text-muted">{detail.status.headline}</p>
        {detail.status.detail ? <p className="mt-1 text-xs text-muted">{detail.status.detail}</p> : null}
      </div>

      {detail.kind === "life_entry" ? <LifeEntryActions nodeId={detail.id} onChanged={onChanged} /> : null}
      {detail.kind === "decision" ? <DecisionActions nodeId={detail.id} onChanged={onChanged} /> : null}

      {detail.actionItems.length > 0 ? (
        <div className="grid gap-2">
          {detail.actionItems.map((item) => (
            <ActionItemRow key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      ) : null}

      {detail.children.length > 0 ? (
        <div className="grid gap-2">
          {detail.children.map((child) => (
            <NodeSummaryRow key={child.id} node={child} onSelect={onSelect} />
          ))}
        </div>
      ) : null}

      {detail.contextChannel.routesTo.feature !== "none" ? (
        <ContextChannelBox nodeId={detail.contextChannel.routesTo.entityId || detail.id} onApplied={onChanged} />
      ) : null}
    </div>
  );
}

export default function MissionControlPage() {
  const [overview, setOverview] = useState<MissionControlOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stack, setStack] = useState<string[]>([]);
  const [detail, setDetail] = useState<MissionControlNodeDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    setLoading(true);
    fetch("/api/mission-control", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (body?.error) {
          setError(body.error);
        } else {
          setOverview(body as MissionControlOverview);
          setError(null);
        }
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const openNode = useCallback((id: string) => {
    setDetailError(null);
    fetch(`/api/mission-control/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (body?.error) {
          setDetailError(body.error);
        } else {
          setDetail(body as MissionControlNodeDetail);
          setStack((prev) => [...prev, id]);
        }
      })
      .catch((fetchError) => setDetailError(fetchError instanceof Error ? fetchError.message : String(fetchError)));
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => {
      const next = prev.slice(0, -1);
      const targetId = next[next.length - 1];
      if (targetId) {
        openNode(targetId);
      } else {
        setDetail(null);
      }
      return next;
    });
  }, [openNode]);

  const refreshCurrent = useCallback(() => {
    const currentId = stack[stack.length - 1];
    if (currentId) {
      openNode(currentId);
    }
    loadOverview();
  }, [stack, openNode, loadOverview]);

  return (
    <MobileShell>
      <h1 className="mb-4 text-lg font-semibold">Mission Control</h1>

      {error ? <ErrorState message={error} /> : null}

      {loading && !overview ? (
        <LoadingState />
      ) : overview ? (
        <div className="grid min-w-0 gap-6">
          {detail ? (
            <>
              {detailError ? <ErrorState message={detailError} title="Could not open that" /> : null}
              <NodeDetailPanel detail={detail} onSelect={openNode} onBack={stack.length > 0 ? goBack : null} onChanged={refreshCurrent} />
            </>
          ) : (
            <>
              <Section title="Needs You Now">
                {overview.needsYouNow.length === 0 ? (
                  <EmptyState text="Nothing pressing." />
                ) : (
                  <div className="grid gap-2">
                    {overview.needsYouNow.map((item) => (
                      <ActionItemRow key={item.id} item={item} onSelect={openNode} />
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Towers">
                <div className="grid gap-2">
                  {overview.towers.map((tower) => (
                    <NodeSummaryRow key={tower.id} node={tower} onSelect={openNode} />
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      ) : null}
    </MobileShell>
  );
}
