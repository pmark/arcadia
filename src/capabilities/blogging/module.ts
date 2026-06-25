import type { CapabilityModule } from "../core.js";

export const bloggingModule: CapabilityModule = {
  id: "blogging",
  name: "Blogging",
  version: "0.1.0",
  migrations: [
    {
      id: "001_blog_tables",
      sql: `
        CREATE TABLE IF NOT EXISTS blog_sites (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          stream_key TEXT NOT NULL,
          site_url TEXT,
          content_repo_path TEXT,
          content_root TEXT,
          status TEXT NOT NULL CHECK (status IN ('active','paused','missing_setup')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS blog_ideas (
          id TEXT PRIMARY KEY,
          site_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          source TEXT NOT NULL,
          summary TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('captured','briefed','drafted','deferred','archived')),
          artifact_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS blog_posts (
          id TEXT PRIMARY KEY,
          site_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          idea_id TEXT,
          title TEXT NOT NULL,
          slug TEXT NOT NULL,
          stream_key TEXT NOT NULL,
          stage TEXT NOT NULL CHECK (stage IN ('idea','brief','draft','review','scheduled','published','logged')),
          scheduled_for TEXT,
          published_at TEXT,
          artifact_id TEXT,
          review_item_id TEXT,
          mission_log_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (idea_id) REFERENCES blog_ideas(id) ON DELETE SET NULL,
          FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
          FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL,
          FOREIGN KEY (mission_log_id) REFERENCES mission_logs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS blog_schedules (
          id TEXT PRIMARY KEY,
          site_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          week_start TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('prepared','needs_review','approved','deferred')),
          artifact_id TEXT,
          review_item_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
          FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_sites_project_stream ON blog_sites(project_id, stream_key);
        CREATE INDEX IF NOT EXISTS idx_blog_sites_stream_key ON blog_sites(stream_key);
        CREATE INDEX IF NOT EXISTS idx_blog_ideas_site_status ON blog_ideas(site_id, status);
        CREATE INDEX IF NOT EXISTS idx_blog_posts_site_stage ON blog_posts(site_id, stage);
        CREATE INDEX IF NOT EXISTS idx_blog_posts_review_item ON blog_posts(review_item_id);
        CREATE INDEX IF NOT EXISTS idx_blog_schedules_site_week ON blog_schedules(site_id, week_start);
        CREATE INDEX IF NOT EXISTS idx_blog_schedules_review_item ON blog_schedules(review_item_id);
      `
    }
  ],
  commands: [
    { id: "blog.configure_site", title: "Configure blog site", permission: "autonomous", approvalGates: [] },
    { id: "blog.create_idea", title: "Create blog idea", permission: "autonomous", approvalGates: [] },
    { id: "blog.create_brief", title: "Create blog brief", permission: "autonomous", approvalGates: [] },
    { id: "blog.draft_post", title: "Draft blog post", permission: "autonomous", approvalGates: ["publication"] },
    { id: "blog.prepare_schedule", title: "Prepare blog schedule", permission: "autonomous", approvalGates: ["publication"] },
    { id: "blog.list_review_needed", title: "List blog review items", permission: "autonomous", approvalGates: [] },
    { id: "blog.record_published", title: "Record published blog post", permission: "needs_mark", approvalGates: ["publication"] }
  ],
  eventHandlers: [],
  permissions: ["autonomous", "codex", "needs_mark", "blocked"],
  artifactTypes: [
    { type: "blog_idea", title: "Blog idea" },
    { type: "blog_brief", title: "Blog brief" },
    { type: "blog_draft", title: "Blog draft" },
    { type: "blog_schedule", title: "Blog schedule" },
    { type: "blog_publish_record", title: "Blog publish record" }
  ],
  dashboardSurfaces: [{ id: "blogging.overview", title: "Blogging overview" }],
  mcp: {
    tools: [
      "arcadia.blog.create_idea",
      "arcadia.blog.prepare_schedule",
      "arcadia.blog.draft_post",
      "arcadia.blog.list_review_needed"
    ],
    resources: ["arcadia.blog.sites", "arcadia.blog.posts"]
  }
};
