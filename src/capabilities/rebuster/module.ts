import type { CapabilityModule } from "../core.js";

export const rebusterModule: CapabilityModule = {
  id: "rebuster",
  name: "Rebuster",
  version: "0.1.0",
  migrations: [
    {
      id: "001_rebuster_bridge",
      sql: `
        CREATE TABLE IF NOT EXISTS rebuster_integrations (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE,
          repo_path TEXT,
          base_url TEXT,
          dashboard_url TEXT,
          status_summary TEXT,
          last_health_check_at TEXT,
          last_sync_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS rebuster_events (
          id TEXT PRIMARY KEY,
          external_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK (
            event_type IN (
              'candidate_captured',
              'overlap_ready',
              'decision_required',
              'spec_ready',
              'review_queued',
              'rejected',
              'archived',
              'published'
            )
          ),
          rebus_id TEXT NOT NULL,
          answer TEXT NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          decision_required INTEGER NOT NULL CHECK (decision_required IN (0, 1)),
          recommendation TEXT,
          rebuster_url TEXT NOT NULL,
          artifact_refs_json TEXT NOT NULL DEFAULT '[]',
          occurred_at TEXT NOT NULL,
          review_item_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rebuster_integrations_project ON rebuster_integrations(project_id);
        CREATE INDEX IF NOT EXISTS idx_rebuster_events_project ON rebuster_events(project_id);
        CREATE INDEX IF NOT EXISTS idx_rebuster_events_occurred ON rebuster_events(occurred_at);
        CREATE INDEX IF NOT EXISTS idx_rebuster_events_review ON rebuster_events(review_item_id);
      `
    }
  ],
  commands: [
    { id: "rebuster.configure", title: "Configure Rebuster bridge", permission: "autonomous", approvalGates: [] },
    { id: "rebuster.status", title: "Show Rebuster bridge status", permission: "autonomous", approvalGates: [] },
    { id: "rebuster.create_rebus", title: "Create Rebuster rebus", permission: "autonomous", approvalGates: [] },
    { id: "rebuster.ingest_event", title: "Ingest Rebuster event", permission: "autonomous", approvalGates: [] }
  ],
  eventHandlers: [{ eventType: "rebuster.*", handlerId: "rebuster.event_snapshot" }],
  permissions: ["autonomous", "codex", "requires_review", "blocked"],
  artifactTypes: [
    { type: "rebuster_external_artifact", title: "Rebuster external artifact" },
    { type: "rebuster_decision_reference", title: "Rebuster Decision reference" }
  ],
  dashboardSurfaces: [{ id: "rebuster.overview", title: "Rebuster overview" }],
  mcp: {
    tools: [
      "arcadia.rebuster.configure",
      "arcadia.rebuster.create_rebus",
      "arcadia.rebuster.ingest_event",
      "arcadia.rebuster.status"
    ],
    resources: ["arcadia.rebuster.status", "arcadia.rebuster.events"]
  }
};
