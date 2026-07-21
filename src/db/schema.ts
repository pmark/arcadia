import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { applyCapabilityMigrations } from "../capabilities/migrations.js";

export function getSchemaPath(): string {
  const fromCwd = path.resolve("database", "schema.sql");
  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = path.resolve(moduleDir, "..", "..", "database", "schema.sql");
  if (existsSync(fromModule)) {
    return fromModule;
  }

  throw new Error("Could not find database/schema.sql");
}

export function readInitialSchema(): string {
  return readFileSync(getSchemaPath(), "utf8");
}

export function applyInitialSchema(db: Database.Database): void {
  db.exec(readInitialSchema());
  applyMigrations(db);
}

export function applyMigrations(db: Database.Database): void {
  ensureCapabilityCoreTables(db);
  ensureProjectSlugColumn(db);
  ensureProjectGoalColumn(db);
  ensureReviewItemsTable(db);
  ensureReviewItemSlugs(db);
  ensureReviewFeedbackTable(db);
  ensureBackBurnerItemsTable(db);
  ensureAskRequestStewardshipColumn(db);
  ensureRequiresReviewCompatibility(db);
  ensureExecutionRunWorkerColumns(db);
  ensureDecisionGatedPlanningColumns(db);
  ensureAskFeedbackTable(db);
  ensureIntelligenceJobsTable(db);
  ensureIntelligenceJobOperationIdColumn(db);
  ensureIntelligenceJobArtifactsTable(db);
  ensureIntelligenceJobArtifactAudioColumns(db);
  ensureOrientationTables(db);
  applyCapabilityMigrations(db);
}

function ensureCapabilityCoreTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_migrations (
      module_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      version TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (module_id, migration_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      source_module TEXT,
      project_id TEXT,
      work_item_id TEXT,
      artifact_id TEXT,
      review_item_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_source_module ON events(source_module);
  `);
}

function ensureProjectSlugColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "slug")) {
    return;
  }

  db.prepare("ALTER TABLE projects ADD COLUMN slug TEXT").run();
  const projects = db.prepare("SELECT id, name FROM projects").all() as Array<{ id: string; name: string }>;
  const update = db.prepare("UPDATE projects SET slug = ? WHERE id = ?");
  for (const project of projects) {
    update.run(slugifyForMigration(project.name), project.id);
  }
}

function ensureProjectGoalColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "goal")) {
    db.prepare("ALTER TABLE projects ADD COLUMN goal TEXT").run();
  }
}

function ensureReviewItemsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      ask_request_id TEXT,
      work_item_id TEXT,
      plan_id TEXT,
      project_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'approved', 'rejected', 'deferred')),
      decision_needed TEXT NOT NULL,
      recommendation TEXT,
      source_input TEXT NOT NULL,
      proposed_action TEXT NOT NULL,
      resolved_intent TEXT NOT NULL,
      confidence_label TEXT NOT NULL,
      confidence REAL NOT NULL,
      missing_fields TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      decision_note TEXT,
      resulting_ask_request_id TEXT,
      FOREIGN KEY (ask_request_id) REFERENCES ask_requests(id) ON DELETE SET NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (plan_id) REFERENCES execution_plans(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (resulting_ask_request_id) REFERENCES ask_requests(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_items_status ON review_items(status);
    CREATE INDEX IF NOT EXISTS idx_review_items_project_id ON review_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_review_items_ask_request_id ON review_items(ask_request_id);
  `);
}

function ensureReviewItemSlugs(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(review_items)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "slug")) {
    db.prepare("ALTER TABLE review_items ADD COLUMN slug TEXT").run();
  }

  const rows = db
    .prepare("SELECT rowid, id, slug FROM review_items ORDER BY rowid ASC")
    .all() as Array<{ rowid: number; id: string; slug: string | null }>;
  const used = new Set(rows.map((row) => row.slug).filter((slug): slug is string => Boolean(slug)));
  const update = db.prepare("UPDATE review_items SET slug = ? WHERE id = ?");
  let nextNumber = nextReviewSlugNumber(used);

  for (const row of rows) {
    if (row.slug) {
      continue;
    }
    while (used.has(`R${nextNumber}`)) {
      nextNumber += 1;
    }
    const slug = `R${nextNumber}`;
    used.add(slug);
    update.run(slug, row.id);
  }

  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_slug ON review_items(slug)").run();
}

function ensureReviewFeedbackTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_feedback (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      review_slug TEXT NOT NULL,
      source_input TEXT,
      proposed_interpretation TEXT,
      feedback_type TEXT NOT NULL,
      raw_reply TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES review_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_review_feedback_review_id ON review_feedback(review_id);
  `);
}

function ensureAskFeedbackTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_feedback (
      id TEXT PRIMARY KEY,
      ask_request_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('up', 'down')),
      note TEXT,
      source_ingress TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ask_request_id) REFERENCES ask_requests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ask_feedback_ask_request_id ON ask_feedback(ask_request_id);
    CREATE INDEX IF NOT EXISTS idx_ask_feedback_created_at ON ask_feedback(created_at);
  `);
}

function ensureIntelligenceJobsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intelligence_jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL,
      client_app TEXT NOT NULL,
      project_id TEXT,
      mission_id TEXT,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'blocked')
      ),
      selected_route TEXT,
      result_json TEXT,
      validation_json TEXT,
      usage_json TEXT,
      error_code TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_status ON intelligence_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_created_at ON intelligence_jobs(created_at);
  `);
}

/**
 * Renames the original `capability` column to `operation_id`. It always
 * stored the companion app's own request identifier (see
 * IntelligenceRequest.operationId), never an Arcadia routing capability —
 * the column name predates that distinction and was ambiguous against the
 * newer `capability` routing field carried inside `request_json`.
 */
function ensureIntelligenceJobOperationIdColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(intelligence_jobs)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "operation_id")) {
    return;
  }
  if (columns.some((column) => column.name === "capability")) {
    db.prepare("ALTER TABLE intelligence_jobs RENAME COLUMN capability TO operation_id").run();
  }
}

function ensureIntelligenceJobArtifactsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intelligence_job_artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES intelligence_jobs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      relative_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intelligence_job_artifacts_job_id ON intelligence_job_artifacts(job_id);
  `);
}

/**
 * Adds nullable audio-specific columns to `intelligence_job_artifacts` for
 * `kind = 'audio'` artifacts (text-to-speech). Image artifacts leave them null,
 * just as audio artifacts leave `width`/`height` null. Additive and idempotent
 * (guarded by PRAGMA table_info), matching ensureIntelligenceJobOperationIdColumn.
 */
function ensureIntelligenceJobArtifactAudioColumns(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(intelligence_job_artifacts)")
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<{ name: string; ddl: string }> = [
    { name: "format", ddl: "ALTER TABLE intelligence_job_artifacts ADD COLUMN format TEXT" },
    { name: "duration_seconds", ddl: "ALTER TABLE intelligence_job_artifacts ADD COLUMN duration_seconds REAL" },
    { name: "sample_rate_hz", ddl: "ALTER TABLE intelligence_job_artifacts ADD COLUMN sample_rate_hz INTEGER" },
    { name: "channels", ddl: "ALTER TABLE intelligence_job_artifacts ADD COLUMN channels INTEGER" },
  ];
  for (const addition of additions) {
    if (!existing.has(addition.name)) {
      db.prepare(addition.ddl).run();
    }
  }
}

/**
 * The Daily Orientation Packet's Context Ledger. Holds a small, curated set of
 * orientation facts (not tasks — see docs/plans/daily-orientation-packet).
 * `orientation_packets` is the once-per-local-day idempotency guard plus a
 * history of what was actually composed/sent.
 */
function ensureOrientationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orientation_entries (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL CHECK (
        entry_type IN ('active_concern', 'standing_responsibility', 'time_bound', 'parked_idea')
      ),
      title TEXT NOT NULL,
      detail TEXT,
      area TEXT,
      project_id TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
      horizon TEXT NOT NULL CHECK (horizon IN ('now', 'soon', 'later', 'someday')),
      due_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'confirmed', 'completed', 'dropped')),
      last_confirmed_at TEXT NOT NULL,
      asserted_at TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orientation_entries_status ON orientation_entries(status);
    CREATE INDEX IF NOT EXISTS idx_orientation_entries_type ON orientation_entries(entry_type);
    CREATE INDEX IF NOT EXISTS idx_orientation_entries_due ON orientation_entries(due_at);

    CREATE TABLE IF NOT EXISTS orientation_packets (
      id TEXT PRIMARY KEY,
      local_date TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      entry_snapshot_json TEXT NOT NULL,
      discord_message_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureBackBurnerItemsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS back_burner_items (
      id TEXT PRIMARY KEY,
      original_input TEXT NOT NULL,
      ingress_source TEXT NOT NULL,
      classification TEXT NOT NULL CHECK (
        classification IN (
          'ExecutionRequest',
          'ReviewResponse',
          'ClarificationResponse',
          'ArcadiaFeedback',
          'BugReport',
          'Idea',
          'Question',
          'IncubatingThought'
        )
      ),
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('incubating', 'opportunistic', 'promoted', 'archived')),
      suggested_next_step TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      promoted_at TEXT,
      promoted_work_item_id TEXT,
      FOREIGN KEY (promoted_work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_back_burner_items_status ON back_burner_items(status);
    CREATE INDEX IF NOT EXISTS idx_back_burner_items_created_at ON back_burner_items(created_at);
  `);
}

function ensureAskRequestStewardshipColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(ask_requests)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "stewardship_json")) {
    db.prepare("ALTER TABLE ask_requests ADD COLUMN stewardship_json TEXT").run();
  }
}

function ensureRequiresReviewCompatibility(db: Database.Database): void {
  repairLegacyRequiresReviewReferences(db);

  const tables = [
    "work_items",
    "execution_plans",
    "execution_plan_steps",
    "execution_runs",
    "execution_run_steps",
    "ask_requests"
  ];

  for (const table of tables) {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!row?.sql || row.sql.includes("'requires_review'")) {
      continue;
    }

    rebuildTableWithCurrentSchema(db, table);
  }

  repairLegacyRequiresReviewReferences(db);
}

function ensureExecutionRunWorkerColumns(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'execution_runs'")
    .get() as { sql: string } | undefined;

  if (row?.sql && !row.sql.includes("'pending_execution'")) {
    rebuildTableWithCurrentSchema(db, "execution_runs");
  }

  const columns = db.prepare("PRAGMA table_info(execution_runs)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("pid")) {
    db.prepare("ALTER TABLE execution_runs ADD COLUMN pid INTEGER").run();
  }
  if (!columnNames.has("review_item_id")) {
    db.prepare("ALTER TABLE execution_runs ADD COLUMN review_item_id TEXT REFERENCES review_items(id) ON DELETE SET NULL").run();
  }
  if (!columnNames.has("executor_name")) {
    db.prepare("ALTER TABLE execution_runs ADD COLUMN executor_name TEXT").run();
  }
}

function ensureDecisionGatedPlanningColumns(db: Database.Database): void {
  const reviewColumns = new Set(
    (db.prepare("PRAGMA table_info(review_items)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!reviewColumns.has("artifact_id")) {
    db.prepare("ALTER TABLE review_items ADD COLUMN artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL").run();
  }
  if (!reviewColumns.has("codex_invocation_id")) {
    db.prepare("ALTER TABLE review_items ADD COLUMN codex_invocation_id TEXT REFERENCES codex_invocations(id) ON DELETE SET NULL").run();
  }

  const runColumns = new Set(
    (db.prepare("PRAGMA table_info(execution_runs)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!runColumns.has("retry_of_run_id")) {
    db.prepare("ALTER TABLE execution_runs ADD COLUMN retry_of_run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL").run();
  }

  const duplicateRunDecisions = db.prepare(
    `SELECT review_item_id
     FROM execution_runs
     WHERE review_item_id IS NOT NULL
     GROUP BY review_item_id
     HAVING COUNT(*) > 1`
  ).all() as Array<{ review_item_id: string }>;
  for (const duplicate of duplicateRunDecisions) {
    const runs = db.prepare(
      `SELECT id FROM execution_runs
       WHERE review_item_id = ?
       ORDER BY created_at ASC, rowid ASC`
    ).all(duplicate.review_item_id) as Array<{ id: string }>;
    for (const run of runs.slice(1)) {
      db.prepare("UPDATE execution_runs SET review_item_id = NULL WHERE id = ?").run(run.id);
    }
    process.stderr.write(`Arcadia migration: preserved earliest Run link for Decision ${duplicate.review_item_id}.\n`);
  }

  const duplicateArtifactLinks = db.prepare(
    `SELECT run_id, artifact_id
     FROM run_artifacts
     GROUP BY run_id, artifact_id
     HAVING COUNT(*) > 1`
  ).all() as Array<{ run_id: string; artifact_id: string }>;
  for (const duplicate of duplicateArtifactLinks) {
    const links = db.prepare(
      `SELECT rowid FROM run_artifacts
       WHERE run_id = ? AND artifact_id = ?
       ORDER BY created_at ASC, rowid ASC`
    ).all(duplicate.run_id, duplicate.artifact_id) as Array<{ rowid: number }>;
    for (const link of links.slice(1)) {
      db.prepare("DELETE FROM run_artifacts WHERE rowid = ?").run(link.rowid);
    }
    process.stderr.write(`Arcadia migration: removed duplicate Artifact link for Run ${duplicate.run_id}.\n`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_items_artifact_id ON review_items(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_review_items_codex_invocation_id ON review_items(codex_invocation_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_runs_review_item_id_unique
      ON execution_runs(review_item_id) WHERE review_item_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_execution_runs_retry_of_run_id ON execution_runs(retry_of_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_artifacts_run_artifact_unique
      ON run_artifacts(run_id, artifact_id);
  `);
}

function repairLegacyRequiresReviewReferences(db: Database.Database): void {
  const rows = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%__legacy_requires_review%'"
    )
    .all() as Array<{ name: string; sql: string }>;

  for (const row of rows) {
    rebuildTableWithCurrentSchema(db, row.name);
  }
}

function rebuildTableWithCurrentSchema(db: Database.Database, table: string): void {
  const schema = readInitialSchema();
  const tempTable = `${table}__requires_review_rebuild`;
  const createStatement = createStatementForTableName(extractCreateTableStatement(schema, table), table, tempTable);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const columnNames = columns.map((column) => column.name);
  const quotedColumns = columnNames.map((column) => `"${column}"`).join(", ");

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTable)}`).run();
      db.exec(createStatement);
      db.prepare(`INSERT INTO ${quoteIdentifier(tempTable)} (${quotedColumns}) SELECT ${quotedColumns} FROM ${quoteIdentifier(table)}`).run();
      db.prepare(`DROP TABLE ${quoteIdentifier(table)}`).run();
      db.prepare(`ALTER TABLE ${quoteIdentifier(tempTable)} RENAME TO ${quoteIdentifier(table)}`).run();
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function extractCreateTableStatement(schema: string, table: string): string {
  const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`);
  const match = schema.match(pattern);
  if (!match) {
    throw new Error(`Could not find CREATE TABLE statement for ${table}`);
  }

  return match[0];
}

function createStatementForTableName(statement: string, table: string, replacement: string): string {
  return statement.replace(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${escapeRegExp(table)}\\b`),
    `CREATE TABLE ${quoteIdentifier(replacement)}`
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextReviewSlugNumber(slugs: Set<string>): number {
  let highest = 0;
  for (const slug of slugs) {
    const match = /^R(\d+)$/i.exec(slug);
    if (match?.[1]) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

function slugifyForMigration(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "project";
}
