import type Database from "better-sqlite3";
import { createId } from "../../utils/id.js";
import { nowIso } from "../../utils/time.js";

export type BlogSiteStatus = "active" | "paused" | "missing_setup";
export type BlogIdeaStatus = "captured" | "briefed" | "drafted" | "deferred" | "archived";
export type BlogPostStage = "idea" | "brief" | "draft" | "review" | "scheduled" | "published" | "logged";
export type BlogScheduleStatus = "prepared" | "needs_review" | "approved" | "deferred";

export interface BlogSite {
  id: string;
  project_id: string;
  name: string;
  stream_key: string;
  site_url: string | null;
  content_repo_path: string | null;
  content_root: string | null;
  status: BlogSiteStatus;
  created_at: string;
  updated_at: string;
}

export interface BlogIdea {
  id: string;
  site_id: string;
  project_id: string;
  title: string;
  source: string;
  summary: string;
  status: BlogIdeaStatus;
  artifact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  site_id: string;
  project_id: string;
  idea_id: string | null;
  title: string;
  slug: string;
  stream_key: string;
  stage: BlogPostStage;
  scheduled_for: string | null;
  published_at: string | null;
  artifact_id: string | null;
  review_item_id: string | null;
  mission_log_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogSchedule {
  id: string;
  site_id: string;
  project_id: string;
  week_start: string;
  status: BlogScheduleStatus;
  artifact_id: string | null;
  review_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogReviewItem {
  kind: "post" | "schedule";
  id: string;
  title: string;
  site_id: string;
  site_name: string;
  stream_key: string;
  project_id: string;
  project_name: string;
  status: string;
  artifact_id: string | null;
  artifact_path: string | null;
  review_item_id: string;
  review_slug: string | null;
  decision_needed: string;
  updated_at: string;
}

export interface BlogDashboardSite {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  stream_key: string;
  status: BlogSiteStatus;
  next_scheduled_title: string | null;
  next_scheduled_for: string | null;
  drafts_needing_review: number;
  ideas_count: number;
  posts_count: number;
  latest_artifact_path: string | null;
  updated_at: string;
}

export function upsertBlogSite(
  db: Database.Database,
  input: {
    projectId: string;
    name: string;
    streamKey: string;
    siteUrl?: string | null;
    contentRepoPath?: string | null;
    contentRoot?: string | null;
    status?: BlogSiteStatus;
  }
): BlogSite {
  const timestamp = nowIso();
  const existing = getBlogSiteByProjectStream(db, input.projectId, input.streamKey);
  const site: BlogSite = {
    id: existing?.id ?? createId("blogSite"),
    project_id: input.projectId,
    name: requireText(input.name, "Blog site name"),
    stream_key: normalizeStreamKey(input.streamKey),
    site_url: nullable(input.siteUrl),
    content_repo_path: nullable(input.contentRepoPath),
    content_root: nullable(input.contentRoot),
    status: input.status ?? existing?.status ?? "active",
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO blog_sites (
      id, project_id, name, stream_key, site_url, content_repo_path, content_root,
      status, created_at, updated_at
    ) VALUES (
      @id, @project_id, @name, @stream_key, @site_url, @content_repo_path, @content_root,
      @status, @created_at, @updated_at
    )
    ON CONFLICT(project_id, stream_key) DO UPDATE SET
      name = excluded.name,
      site_url = excluded.site_url,
      content_repo_path = excluded.content_repo_path,
      content_root = excluded.content_root,
      status = excluded.status,
      updated_at = excluded.updated_at`
  ).run(site);

  return getBlogSiteByProjectStream(db, site.project_id, site.stream_key) as BlogSite;
}

export function listBlogSites(db: Database.Database): BlogSite[] {
  return db
    .prepare("SELECT * FROM blog_sites ORDER BY stream_key ASC, name ASC")
    .all() as BlogSite[];
}

export function getBlogSite(db: Database.Database, id: string): BlogSite | null {
  return (db.prepare("SELECT * FROM blog_sites WHERE id = ?").get(id) as BlogSite | undefined) ?? null;
}

export function getBlogSiteByProjectStream(
  db: Database.Database,
  projectId: string,
  streamKey: string
): BlogSite | null {
  return (
    (db
      .prepare("SELECT * FROM blog_sites WHERE project_id = ? AND stream_key = ?")
      .get(projectId, normalizeStreamKey(streamKey)) as BlogSite | undefined) ?? null
  );
}

export function createBlogIdea(
  db: Database.Database,
  input: {
    siteId: string;
    projectId: string;
    title: string;
    source: string;
    summary: string;
  }
): BlogIdea {
  const timestamp = nowIso();
  const idea: BlogIdea = {
    id: createId("blogIdea"),
    site_id: input.siteId,
    project_id: input.projectId,
    title: requireText(input.title, "Blog idea title"),
    source: requireText(input.source, "Blog idea source"),
    summary: requireText(input.summary, "Blog idea summary"),
    status: "captured",
    artifact_id: null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO blog_ideas (
      id, site_id, project_id, title, source, summary, status, artifact_id, created_at, updated_at
    ) VALUES (
      @id, @site_id, @project_id, @title, @source, @summary, @status, @artifact_id, @created_at, @updated_at
    )`
  ).run(idea);

  return idea;
}

export function updateBlogIdeaArtifact(
  db: Database.Database,
  ideaId: string,
  artifactId: string,
  status?: BlogIdeaStatus
): BlogIdea | null {
  db.prepare("UPDATE blog_ideas SET artifact_id = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?")
    .run(artifactId, status ?? null, nowIso(), ideaId);
  return getBlogIdea(db, ideaId);
}

export function getBlogIdea(db: Database.Database, id: string): BlogIdea | null {
  return (db.prepare("SELECT * FROM blog_ideas WHERE id = ?").get(id) as BlogIdea | undefined) ?? null;
}

export function createBlogPost(
  db: Database.Database,
  input: {
    siteId: string;
    projectId: string;
    ideaId?: string | null;
    title: string;
    slug: string;
    streamKey: string;
    stage: BlogPostStage;
    artifactId?: string | null;
    reviewItemId?: string | null;
    missionLogId?: string | null;
    scheduledFor?: string | null;
  }
): BlogPost {
  const timestamp = nowIso();
  const post: BlogPost = {
    id: createId("blogPost"),
    site_id: input.siteId,
    project_id: input.projectId,
    idea_id: input.ideaId ?? null,
    title: requireText(input.title, "Blog post title"),
    slug: requireText(input.slug, "Blog post slug"),
    stream_key: normalizeStreamKey(input.streamKey),
    stage: input.stage,
    scheduled_for: input.scheduledFor ?? null,
    published_at: null,
    artifact_id: input.artifactId ?? null,
    review_item_id: input.reviewItemId ?? null,
    mission_log_id: input.missionLogId ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO blog_posts (
      id, site_id, project_id, idea_id, title, slug, stream_key, stage, scheduled_for,
      published_at, artifact_id, review_item_id, mission_log_id, created_at, updated_at
    ) VALUES (
      @id, @site_id, @project_id, @idea_id, @title, @slug, @stream_key, @stage, @scheduled_for,
      @published_at, @artifact_id, @review_item_id, @mission_log_id, @created_at, @updated_at
    )`
  ).run(post);

  return post;
}

export function updateBlogPostLinks(
  db: Database.Database,
  postId: string,
  input: { artifactId?: string | null; reviewItemId?: string | null; missionLogId?: string | null; stage?: BlogPostStage }
): BlogPost | null {
  db.prepare(
    `UPDATE blog_posts
     SET artifact_id = COALESCE(@artifact_id, artifact_id),
         review_item_id = COALESCE(@review_item_id, review_item_id),
         mission_log_id = COALESCE(@mission_log_id, mission_log_id),
         stage = COALESCE(@stage, stage),
         updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id: postId,
    artifact_id: input.artifactId ?? null,
    review_item_id: input.reviewItemId ?? null,
    mission_log_id: input.missionLogId ?? null,
    stage: input.stage ?? null,
    updated_at: nowIso()
  });
  return getBlogPost(db, postId);
}

export function getBlogPost(db: Database.Database, id: string): BlogPost | null {
  return (db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id) as BlogPost | undefined) ?? null;
}

export function createBlogSchedule(
  db: Database.Database,
  input: {
    siteId: string;
    projectId: string;
    weekStart: string;
    artifactId?: string | null;
    reviewItemId?: string | null;
    status?: BlogScheduleStatus;
  }
): BlogSchedule {
  const timestamp = nowIso();
  const schedule: BlogSchedule = {
    id: createId("blogSchedule"),
    site_id: input.siteId,
    project_id: input.projectId,
    week_start: requireText(input.weekStart, "Schedule week start"),
    status: input.status ?? "prepared",
    artifact_id: input.artifactId ?? null,
    review_item_id: input.reviewItemId ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO blog_schedules (
      id, site_id, project_id, week_start, status, artifact_id, review_item_id, created_at, updated_at
    ) VALUES (
      @id, @site_id, @project_id, @week_start, @status, @artifact_id, @review_item_id, @created_at, @updated_at
    )`
  ).run(schedule);

  return schedule;
}

export function updateBlogScheduleLinks(
  db: Database.Database,
  scheduleId: string,
  input: { artifactId?: string | null; reviewItemId?: string | null; status?: BlogScheduleStatus }
): BlogSchedule | null {
  db.prepare(
    `UPDATE blog_schedules
     SET artifact_id = COALESCE(@artifact_id, artifact_id),
         review_item_id = COALESCE(@review_item_id, review_item_id),
         status = COALESCE(@status, status),
         updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id: scheduleId,
    artifact_id: input.artifactId ?? null,
    review_item_id: input.reviewItemId ?? null,
    status: input.status ?? null,
    updated_at: nowIso()
  });
  return getBlogSchedule(db, scheduleId);
}

export function getBlogSchedule(db: Database.Database, id: string): BlogSchedule | null {
  return (db.prepare("SELECT * FROM blog_schedules WHERE id = ?").get(id) as BlogSchedule | undefined) ?? null;
}

export function listBlogReviewItems(db: Database.Database): BlogReviewItem[] {
  const postRows = db
    .prepare(
      `SELECT
        'post' AS kind,
        bp.id,
        bp.title,
        bs.id AS site_id,
        bs.name AS site_name,
        bs.stream_key,
        p.id AS project_id,
        p.name AS project_name,
        bp.stage AS status,
        bp.artifact_id,
        a.path AS artifact_path,
        ri.id AS review_item_id,
        ri.slug AS review_slug,
        ri.decision_needed,
        bp.updated_at
      FROM blog_posts bp
      JOIN blog_sites bs ON bs.id = bp.site_id
      JOIN projects p ON p.id = bp.project_id
      JOIN review_items ri ON ri.id = bp.review_item_id AND ri.status = 'open'
      LEFT JOIN artifacts a ON a.id = bp.artifact_id`
    )
    .all() as BlogReviewItem[];

  const scheduleRows = db
    .prepare(
      `SELECT
        'schedule' AS kind,
        bsched.id,
        'Blog schedule for week of ' || bsched.week_start AS title,
        bsite.id AS site_id,
        bsite.name AS site_name,
        bsite.stream_key,
        p.id AS project_id,
        p.name AS project_name,
        bsched.status,
        bsched.artifact_id,
        a.path AS artifact_path,
        ri.id AS review_item_id,
        ri.slug AS review_slug,
        ri.decision_needed,
        bsched.updated_at
      FROM blog_schedules bsched
      JOIN blog_sites bsite ON bsite.id = bsched.site_id
      JOIN projects p ON p.id = bsched.project_id
      JOIN review_items ri ON ri.id = bsched.review_item_id AND ri.status = 'open'
      LEFT JOIN artifacts a ON a.id = bsched.artifact_id`
    )
    .all() as BlogReviewItem[];

  return [...postRows, ...scheduleRows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function listBlogDashboardSites(db: Database.Database): BlogDashboardSite[] {
  return db
    .prepare(
      `SELECT
        bs.id,
        bs.project_id,
        p.name AS project_name,
        bs.name,
        bs.stream_key,
        bs.status,
        (
          SELECT bp.title
          FROM blog_posts bp
          WHERE bp.site_id = bs.id AND bp.stage = 'scheduled' AND bp.scheduled_for IS NOT NULL
          ORDER BY bp.scheduled_for ASC
          LIMIT 1
        ) AS next_scheduled_title,
        (
          SELECT bp.scheduled_for
          FROM blog_posts bp
          WHERE bp.site_id = bs.id AND bp.stage = 'scheduled' AND bp.scheduled_for IS NOT NULL
          ORDER BY bp.scheduled_for ASC
          LIMIT 1
        ) AS next_scheduled_for,
        (
          SELECT COUNT(*)
          FROM blog_posts bp
          JOIN review_items ri ON ri.id = bp.review_item_id AND ri.status = 'open'
          WHERE bp.site_id = bs.id
        ) + (
          SELECT COUNT(*)
          FROM blog_schedules bsch
          JOIN review_items ri ON ri.id = bsch.review_item_id AND ri.status = 'open'
          WHERE bsch.site_id = bs.id
        ) AS drafts_needing_review,
        (
          SELECT COUNT(*) FROM blog_ideas bi WHERE bi.site_id = bs.id
        ) AS ideas_count,
        (
          SELECT COUNT(*) FROM blog_posts bp WHERE bp.site_id = bs.id
        ) AS posts_count,
        (
          SELECT a.path
          FROM artifacts a
          WHERE a.project_id = bs.project_id AND a.artifact_type LIKE 'blog_%'
          ORDER BY a.updated_at DESC
          LIMIT 1
        ) AS latest_artifact_path,
        bs.updated_at
      FROM blog_sites bs
      JOIN projects p ON p.id = bs.project_id
      ORDER BY bs.updated_at DESC`
    )
    .all() as BlogDashboardSite[];
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStreamKey(value: string): string {
  return requireText(value, "Blog stream").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
