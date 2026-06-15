import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

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
  ensureProjectSlugColumn(db);
  ensureProjectGoalColumn(db);
  ensureReviewItemsTable(db);
  ensureReviewItemSlugs(db);
  ensureReviewFeedbackTable(db);
  ensureBackBurnerItemsTable(db);
  ensureAskRequestStewardshipColumn(db);
  ensureRequiresReviewCompatibility(db);
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
