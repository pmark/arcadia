"use client";

import { useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { TodoListView } from "../../components/todo-views";
import { useApprovals } from "../../hooks/use-approvals";

/** Everything waiting on the operator, phone-first: one column, blocking first. */
export default function TodoPage() {
  const state = useApprovals();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <MobileShell>
      <TodoListView
        approvals={state.approvals}
        expandedKey={expandedKey}
        onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
        pendingId={state.pendingId}
        onAct={state.act}
        message={state.message}
        error={state.error}
        note={state.note}
        hasLoaded={state.hasLoaded}
      />
    </MobileShell>
  );
}
