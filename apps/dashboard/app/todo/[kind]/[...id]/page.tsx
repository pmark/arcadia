"use client";

import { useParams } from "next/navigation";
import { MobileShell } from "../../../../components/mobile-shell";
import { TodoItemView } from "../../../../components/todo-views";
import { useApprovals } from "../../../../hooks/use-approvals";
import { parseTodoPath } from "../../../../lib/approvals";

/** The deep-link target for one to-do: /todo/<kind>/<project>/<id>. */
export default function TodoItemPage() {
  const params = useParams<{ kind?: string; id?: string[] }>();
  const target = parseTodoPath(params?.kind, params?.id);
  const state = useApprovals({ enabled: target !== null });
  return (
    <MobileShell>
      <TodoItemView
        target={target}
        approvals={state.approvals}
        source={state.source}
        pendingId={state.pendingId}
        onAct={state.act}
        message={state.message}
        error={state.error}
        note={state.note}
        hasLoaded={state.hasLoaded}
        onRetry={() => void state.refresh()}
      />
    </MobileShell>
  );
}
