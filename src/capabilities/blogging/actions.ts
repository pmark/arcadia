import type Database from "better-sqlite3";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../../markdown/missionLog.js";
import { createId } from "../../utils/id.js";
import { slugify } from "../../utils/slug.js";
import type { CapabilityRuntime } from "../core.js";
import { createCoreCapabilityApi } from "../coreApi.js";
import {
  blogDraftMarkdown,
  blogIdeaMarkdown,
  blogScheduleMarkdown,
  writeBlogArtifact
} from "./artifacts.js";
import {
  createBlogIdea,
  createBlogPost,
  createBlogSchedule,
  getBlogIdea,
  getBlogSite,
  listBlogReviewItems,
  listBlogSites,
  updateBlogIdeaArtifact,
  updateBlogPostLinks,
  updateBlogScheduleLinks,
  upsertBlogSite,
  type BlogIdea,
  type BlogPost,
  type BlogReviewItem,
  type BlogSchedule,
  type BlogSite
} from "./repository.js";

export function createBloggingRuntime(db: Database.Database, workspacePath: string): CapabilityRuntime {
  return {
    db,
    workspacePath,
    core: createCoreCapabilityApi(db)
  };
}

export function configureBlogSite(
  runtime: CapabilityRuntime,
  input: {
    projectId: string;
    name: string;
    streamKey: string;
    siteUrl?: string | null;
    contentRepoPath?: string | null;
    contentRoot?: string | null;
  }
): BlogSite {
  const context = runtime.core.readProjectContext(input.projectId);
  if (!context) {
    throw new Error("Project is required");
  }

  const site = upsertBlogSite(runtime.db, input);
  runtime.core.emitEvent({
    eventType: "blog.site_configured",
    sourceModule: "blogging",
    projectId: site.project_id,
    payload: {
      siteId: site.id,
      streamKey: site.stream_key,
      name: site.name
    }
  });

  return site;
}

export function createBlogIdeaAction(
  runtime: CapabilityRuntime,
  input: {
    siteId: string;
    title: string;
    summary: string;
    source?: string | null;
  }
): { site: BlogSite; idea: BlogIdea; artifactPath: string; missionLogPath: string } {
  const site = requireSite(runtime.db, input.siteId);
  const context = requireProjectContext(runtime, site.project_id);
  const source = input.source?.trim() || "manual";
  const idea = createBlogIdea(runtime.db, {
    siteId: site.id,
    projectId: site.project_id,
    title: input.title,
    summary: input.summary,
    source
  });
  const artifactPath = writeBlogArtifact({
    workspacePath: runtime.workspacePath,
    streamKey: site.stream_key,
    title: idea.title,
    artifactKind: "idea",
    body: blogIdeaMarkdown({
      title: idea.title,
      streamKey: site.stream_key,
      siteName: site.name,
      projectName: context.project.name,
      source,
      summary: idea.summary
    })
  });
  const artifact = runtime.core.attachArtifact({
    projectId: site.project_id,
    title: `Blog idea: ${idea.title}`,
    artifactType: "blog_idea",
    status: "drafted",
    path: artifactPath
  });
  const updatedIdea = updateBlogIdeaArtifact(runtime.db, idea.id, artifact.id) ?? idea;
  const missionLog = appendBlogMissionLog(runtime, {
    projectId: site.project_id,
    milestoneId: context.activeMilestone?.id ?? null,
    workPerformed: `Created Blogging idea for ${site.name}.`,
    result: `Captured "${idea.title}" as a local blog idea artifact.`,
    nextAction: "Review the idea and promote it to a brief or draft when useful.",
    artifactImpact: artifactPath
  });

  runtime.core.emitEvent({
    eventType: "blog.idea_created",
    sourceModule: "blogging",
    projectId: site.project_id,
    artifactId: artifact.id,
    payload: {
      siteId: site.id,
      ideaId: updatedIdea.id,
      streamKey: site.stream_key,
      artifactPath
    }
  });

  return { site, idea: updatedIdea, artifactPath, missionLogPath: missionLog.markdownPath };
}

export function prepareBlogScheduleAction(
  runtime: CapabilityRuntime,
  input: { siteId: string; weekStart: string }
): { site: BlogSite; schedule: BlogSchedule; artifactPath: string; reviewItemId: string; missionLogPath: string } {
  const site = requireSite(runtime.db, input.siteId);
  const context = requireProjectContext(runtime, site.project_id);
  validateDate(input.weekStart, "Week start");

  const schedule = createBlogSchedule(runtime.db, {
    siteId: site.id,
    projectId: site.project_id,
    weekStart: input.weekStart,
    status: "prepared"
  });
  const artifactPath = writeBlogArtifact({
    workspacePath: runtime.workspacePath,
    streamKey: site.stream_key,
    title: `${site.name} schedule ${input.weekStart}`,
    artifactKind: "schedule",
    date: input.weekStart,
    body: blogScheduleMarkdown({
      siteName: site.name,
      projectName: context.project.name,
      streamKey: site.stream_key,
      weekStart: input.weekStart
    })
  });
  const artifact = runtime.core.attachArtifact({
    projectId: site.project_id,
    title: `Blog schedule: ${site.name} week of ${input.weekStart}`,
    artifactType: "blog_schedule",
    status: "drafted",
    path: artifactPath
  });
  const review = runtime.core.createReviewItem({
    projectId: site.project_id,
    decisionNeeded: `Approve or revise the ${site.name} blog schedule for week of ${input.weekStart}.`,
    recommendation: "Approve only if the topics, timing, voice, and positioning match current project intent.",
    sourceInput: `Prepare blog schedule for ${site.name} week of ${input.weekStart}.`,
    proposedAction: `Use the local schedule artifact at ${artifactPath} as the next editorial plan.`,
    resolvedIntent: "blog.prepare_schedule",
    confidenceLabel: "high",
    confidence: 1,
    context: {
      module: "blogging",
      siteId: site.id,
      scheduleId: schedule.id,
      artifactPath,
      approvalGate: "publication"
    }
  });
  runtime.core.createApprovalGate({
    gateType: "publication",
    reason: "Blog schedules and publishing decisions require explicit approval.",
    status: "pending"
  });
  const updatedSchedule = updateBlogScheduleLinks(runtime.db, schedule.id, {
    artifactId: artifact.id,
    reviewItemId: review.id,
    status: "needs_review"
  }) ?? schedule;
  const missionLog = appendBlogMissionLog(runtime, {
    projectId: site.project_id,
    milestoneId: context.activeMilestone?.id ?? null,
    workPerformed: `Prepared Blogging schedule for ${site.name}.`,
    result: `Created schedule artifact and Requires Review item ${review.slug ?? review.id}.`,
    nextAction: "Mark should approve, reject, defer, or clarify the schedule.",
    artifactImpact: artifactPath
  });

  runtime.core.emitEvent({
    eventType: "blog.schedule_prepared",
    sourceModule: "blogging",
    projectId: site.project_id,
    artifactId: artifact.id,
    reviewItemId: review.id,
    payload: {
      siteId: site.id,
      scheduleId: updatedSchedule.id,
      weekStart: input.weekStart,
      artifactPath
    }
  });

  return { site, schedule: updatedSchedule, artifactPath, reviewItemId: review.id, missionLogPath: missionLog.markdownPath };
}

export function draftBlogPostAction(
  runtime: CapabilityRuntime,
  input: { ideaId: string }
): { site: BlogSite; idea: BlogIdea; post: BlogPost; artifactPath: string; reviewItemId: string; missionLogPath: string } {
  const idea = requireIdea(runtime.db, input.ideaId);
  const site = requireSite(runtime.db, idea.site_id);
  const context = requireProjectContext(runtime, site.project_id);
  const slug = slugify(idea.title);
  const artifactPath = writeBlogArtifact({
    workspacePath: runtime.workspacePath,
    streamKey: site.stream_key,
    title: idea.title,
    artifactKind: "draft",
    body: blogDraftMarkdown({
      title: idea.title,
      siteName: site.name,
      projectName: context.project.name,
      streamKey: site.stream_key,
      summary: idea.summary
    })
  });
  const artifact = runtime.core.attachArtifact({
    projectId: site.project_id,
    title: `Blog draft: ${idea.title}`,
    artifactType: "blog_draft",
    status: "drafted",
    path: artifactPath
  });
  const review = runtime.core.createReviewItem({
    projectId: site.project_id,
    decisionNeeded: `Review the blog draft scaffold "${idea.title}" before it is scheduled or published.`,
    recommendation: "Approve only after voice, positioning, and claims are acceptable.",
    sourceInput: `Draft blog post from idea ${idea.id}.`,
    proposedAction: `Use the local draft artifact at ${artifactPath} as the reviewable draft scaffold.`,
    resolvedIntent: "blog.draft_post",
    confidenceLabel: "high",
    confidence: 1,
    context: {
      module: "blogging",
      siteId: site.id,
      ideaId: idea.id,
      artifactPath,
      approvalGate: "publication"
    }
  });
  runtime.core.createApprovalGate({
    gateType: "publication",
    reason: "Blog drafts require explicit voice and publishing approval before publication.",
    status: "pending"
  });
  const post = createBlogPost(runtime.db, {
    siteId: site.id,
    projectId: site.project_id,
    ideaId: idea.id,
    title: idea.title,
    slug,
    streamKey: site.stream_key,
    stage: "review",
    artifactId: artifact.id,
    reviewItemId: review.id
  });
  updateBlogIdeaArtifact(runtime.db, idea.id, artifact.id, "drafted");
  const missionLog = appendBlogMissionLog(runtime, {
    projectId: site.project_id,
    milestoneId: context.activeMilestone?.id ?? null,
    workPerformed: `Drafted Blogging post scaffold for ${site.name}.`,
    result: `Created draft artifact and Requires Review item ${review.slug ?? review.id}.`,
    nextAction: "Mark should review voice, positioning, and claims before scheduling or publishing.",
    artifactImpact: artifactPath
  });
  const updatedPost = updateBlogPostLinks(runtime.db, post.id, { missionLogId: missionLog.id, stage: "review" }) ?? post;

  runtime.core.emitEvent({
    eventType: "blog.post_drafted",
    sourceModule: "blogging",
    projectId: site.project_id,
    artifactId: artifact.id,
    reviewItemId: review.id,
    payload: {
      siteId: site.id,
      ideaId: idea.id,
      postId: post.id,
      artifactPath
    }
  });

  return { site, idea, post: updatedPost, artifactPath, reviewItemId: review.id, missionLogPath: missionLog.markdownPath };
}

export function listBlogReviewNeededAction(runtime: CapabilityRuntime): BlogReviewItem[] {
  return listBlogReviewItems(runtime.db);
}

export function listBlogSitesAction(runtime: CapabilityRuntime): BlogSite[] {
  return listBlogSites(runtime.db);
}

function requireSite(db: Database.Database, siteId: string): BlogSite {
  const site = getBlogSite(db, siteId);
  if (!site) {
    throw new Error("Blog site is required");
  }
  return site;
}

function requireIdea(db: Database.Database, ideaId: string): BlogIdea {
  const idea = getBlogIdea(db, ideaId);
  if (!idea) {
    throw new Error("Blog idea is required");
  }
  return idea;
}

function requireProjectContext(runtime: CapabilityRuntime, projectId: string) {
  const context = runtime.core.readProjectContext(projectId);
  if (!context) {
    throw new Error("Project is required");
  }
  return context;
}

function appendBlogMissionLog(
  runtime: CapabilityRuntime,
  input: {
    projectId: string;
    milestoneId?: string | null;
    workPerformed: string;
    result: string;
    nextAction: string;
    artifactImpact: string;
  }
): { id: string; markdownPath: string } {
  const context = requireProjectContext(runtime, input.projectId);
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(runtime.workspacePath, context.project.name, logId);
  const missionLog = runtime.core.appendMissionLog({
    id: logId,
    projectId: input.projectId,
    milestoneId: input.milestoneId ?? null,
    workPerformed: input.workPerformed,
    result: input.result,
    nextAction: input.nextAction,
    artifactImpact: input.artifactImpact,
    markdownPath
  });
  writeMissionLogMarkdown(runtime.workspacePath, {
    missionLog,
    project: context.project,
    milestone: context.activeMilestone
  });
  return { id: missionLog.id, markdownPath };
}

function validateDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
}
