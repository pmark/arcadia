import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { listProjects } from "../db/repositories.js";
import type { Project } from "../domain/types.js";
import {
  configureBlogSite,
  createBlogIdeaAction,
  createBloggingRuntime,
  draftBlogPostAction,
  listBlogReviewNeededAction,
  listBlogSitesAction,
  prepareBlogScheduleAction
} from "../capabilities/blogging/actions.js";
import type { BlogIdea, BlogPost, BlogReviewItem, BlogSchedule, BlogSite } from "../capabilities/blogging/repository.js";

export interface BlogSitesCommandData {
  sites: BlogSite[];
}

export interface BlogConfigureSiteCommandData {
  site: BlogSite;
}

export interface BlogCreateIdeaCommandData {
  site: BlogSite;
  idea: BlogIdea;
  artifactPath: string;
  missionLogPath: string;
}

export interface BlogPrepareScheduleCommandData {
  site: BlogSite;
  schedule: BlogSchedule;
  artifactPath: string;
  reviewItemId: string;
  missionLogPath: string;
}

export interface BlogDraftPostCommandData {
  site: BlogSite;
  idea: BlogIdea;
  post: BlogPost;
  artifactPath: string;
  reviewItemId: string;
  missionLogPath: string;
}

export interface BlogReviewCommandData {
  items: BlogReviewItem[];
}

export function runBlogSitesCommand(options: { workspace: string }): CommandSuccess<BlogSitesCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const sites = withDatabase(workspacePath, (db) => listBlogSitesAction(createBloggingRuntime(db, workspacePath)));

  return createSuccess({
    command: "blog.sites",
    workspace: workspacePath,
    data: { sites }
  });
}

export function runBlogConfigureSiteCommand(options: {
  workspace: string;
  project: string;
  stream: string;
  name: string;
  siteUrl?: string;
  contentRepoPath?: string;
  contentRoot?: string;
}): CommandSuccess<BlogConfigureSiteCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const site = withDatabase(workspacePath, (db) => {
    const project = resolveProject(db, options.project);
    return configureBlogSite(createBloggingRuntime(db, workspacePath), {
      projectId: project.id,
      name: options.name,
      streamKey: options.stream,
      siteUrl: options.siteUrl,
      contentRepoPath: options.contentRepoPath,
      contentRoot: options.contentRoot
    });
  });

  return createSuccess({
    command: "blog.configure-site",
    workspace: workspacePath,
    data: { site }
  });
}

export function runBlogCreateIdeaCommand(options: {
  workspace: string;
  siteId: string;
  title: string;
  summary: string;
  source?: string;
}): CommandSuccess<BlogCreateIdeaCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db) =>
    createBlogIdeaAction(createBloggingRuntime(db, workspacePath), {
      siteId: options.siteId,
      title: options.title,
      summary: options.summary,
      source: options.source
    })
  );

  return createSuccess({
    command: "blog.create-idea",
    workspace: workspacePath,
    data,
    artifacts: [data.artifactPath, data.missionLogPath]
  });
}

export function runBlogPrepareScheduleCommand(options: {
  workspace: string;
  siteId: string;
  week: string;
}): CommandSuccess<BlogPrepareScheduleCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db) =>
    prepareBlogScheduleAction(createBloggingRuntime(db, workspacePath), {
      siteId: options.siteId,
      weekStart: options.week
    })
  );

  return createSuccess({
    command: "blog.prepare-schedule",
    workspace: workspacePath,
    data,
    artifacts: [data.artifactPath, data.missionLogPath]
  });
}

export function runBlogDraftPostCommand(options: {
  workspace: string;
  ideaId: string;
}): CommandSuccess<BlogDraftPostCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db) =>
    draftBlogPostAction(createBloggingRuntime(db, workspacePath), {
      ideaId: options.ideaId
    })
  );

  return createSuccess({
    command: "blog.draft-post",
    workspace: workspacePath,
    data,
    artifacts: [data.artifactPath, data.missionLogPath]
  });
}

export function runBlogReviewCommand(options: { workspace: string }): CommandSuccess<BlogReviewCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const items = withDatabase(workspacePath, (db) => listBlogReviewNeededAction(createBloggingRuntime(db, workspacePath)));

  return createSuccess({
    command: "blog.review",
    workspace: workspacePath,
    data: { items }
  });
}

export function renderBlogSitesSuccess(response: CommandSuccess<BlogSitesCommandData>): string[] {
  if (response.data.sites.length === 0) {
    return ["No blog sites configured."];
  }

  return [
    "Blog sites",
    ...response.data.sites.map((site) =>
      `${site.name} (${site.stream_key})\n  ID: ${site.id}\n  Project: ${site.project_id}\n  Status: ${site.status}`
    )
  ];
}

export function renderBlogConfigureSiteSuccess(response: CommandSuccess<BlogConfigureSiteCommandData>): string[] {
  return [
    `Configured blog site: ${response.data.site.name}`,
    `ID: ${response.data.site.id}`,
    `Stream: ${response.data.site.stream_key}`,
    `Status: ${response.data.site.status}`
  ];
}

export function renderBlogCreateIdeaSuccess(response: CommandSuccess<BlogCreateIdeaCommandData>): string[] {
  return [
    `Created blog idea: ${response.data.idea.title}`,
    `Idea: ${response.data.idea.id}`,
    `Site: ${response.data.site.name}`,
    `Artifact: ${response.data.artifactPath}`,
    `Mission log: ${response.data.missionLogPath}`
  ];
}

export function renderBlogPrepareScheduleSuccess(response: CommandSuccess<BlogPrepareScheduleCommandData>): string[] {
  return [
    `Prepared blog schedule: ${response.data.site.name}`,
    `Schedule: ${response.data.schedule.id}`,
    `Week: ${response.data.schedule.week_start}`,
    `Review: ${response.data.reviewItemId}`,
    `Artifact: ${response.data.artifactPath}`,
    `Mission log: ${response.data.missionLogPath}`
  ];
}

export function renderBlogDraftPostSuccess(response: CommandSuccess<BlogDraftPostCommandData>): string[] {
  return [
    `Drafted blog post: ${response.data.post.title}`,
    `Post: ${response.data.post.id}`,
    `Review: ${response.data.reviewItemId}`,
    `Artifact: ${response.data.artifactPath}`,
    `Mission log: ${response.data.missionLogPath}`
  ];
}

export function renderBlogReviewSuccess(response: CommandSuccess<BlogReviewCommandData>): string[] {
  if (response.data.items.length === 0) {
    return ["No blog posts or schedules need review."];
  }

  return [
    "Blog review needed",
    ...response.data.items.map((item) =>
      `${item.title} [${item.kind}]\n  Review: ${item.review_slug ?? item.review_item_id}\n  Project: ${item.project_name}\n  Artifact: ${item.artifact_path ?? "None"}`
    )
  ];
}

function resolveProject(db: Parameters<typeof listProjects>[0], reference: string): Project {
  const normalized = normalize(reference);
  const matches = listProjects(db).filter((project) =>
    project.id === reference || project.slug === normalized || normalize(project.name) === normalized
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw validationError("Project reference is ambiguous.", {
      reference,
      matches: matches.map((project) => ({ id: project.id, name: project.name }))
    });
  }

  throw validationError("Project not found.", { reference });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
