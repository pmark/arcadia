import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runBlogConfigureSiteCommand,
  runBlogCreateIdeaCommand,
  runBlogDraftPostCommand,
  runBlogPrepareScheduleCommand,
  runBlogReviewCommand,
  runBlogSitesCommand
} from "../src/commands/blog.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, createProjectWithInitialWork } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Blogging capability", () => {
  it("configures a site and creates visible idea, schedule, draft, review, event, and mission-log records", () => {
    const workspace = initializedWorkspace();
    const project = withDatabase(workspace, (db) =>
      createProjectWithInitialWork(db, {
        name: "MIDI Opener",
        mission: "Help people work with MIDI files.",
        goal: "Keep product education moving.",
        status: "active",
        currentMilestone: "Publish useful updates",
        nextAction: "Prepare the next blog schedule",
        workClassification: "autonomous"
      }).project
    );

    const configured = runBlogConfigureSiteCommand({
      workspace,
      project: project.id,
      stream: "midi_opener",
      name: "MIDI Opener Blog"
    });
    expect(configured.data.site.stream_key).toBe("midi_opener");

    const sites = runBlogSitesCommand({ workspace });
    expect(sites.data.sites).toHaveLength(1);

    const idea = runBlogCreateIdeaCommand({
      workspace,
      siteId: configured.data.site.id,
      title: "How to open a MIDI file",
      summary: "A practical tutorial for people who receive a MIDI file and need to inspect it.",
      source: "recent_mission_logs"
    });
    expect(existsSync(path.join(workspace, idea.data.artifactPath))).toBe(true);
    expect(readFileSync(path.join(workspace, idea.data.artifactPath), "utf8")).toContain("How to open a MIDI file");
    expect(existsSync(path.join(workspace, idea.data.missionLogPath))).toBe(true);

    const schedule = runBlogPrepareScheduleCommand({
      workspace,
      siteId: configured.data.site.id,
      week: "2026-06-29"
    });
    expect(schedule.data.reviewItemId).toMatch(/^review_/);
    expect(existsSync(path.join(workspace, schedule.data.artifactPath))).toBe(true);

    const draft = runBlogDraftPostCommand({
      workspace,
      ideaId: idea.data.idea.id
    });
    expect(draft.data.reviewItemId).toMatch(/^review_/);
    expect(existsSync(path.join(workspace, draft.data.artifactPath))).toBe(true);

    const review = runBlogReviewCommand({ workspace });
    expect(review.data.items.map((item) => item.kind).sort()).toEqual(["post", "schedule"]);
    expect(review.data.items.map((item) => item.artifact_path)).toContain(draft.data.artifactPath);

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.capabilities.map((capability) => capability.id)).toContain("blogging");
    expect(snapshot.blogging.sites[0]).toMatchObject({
      name: "MIDI Opener Blog",
      streamKey: "midi_opener",
      draftsNeedingReview: 2,
      ideasCount: 1,
      postsCount: 1
    });
    expect(snapshot.blogging.reviewItems).toHaveLength(2);
    expect(snapshot.activityEvents.map((event) => event.eventType)).toContain("blog.idea_created");
    expect(snapshot.activityEvents.map((event) => event.eventType)).toContain("blog.schedule_prepared");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "capability_migrations")).toBeGreaterThanOrEqual(1);
      expect(countRows(db, "blog_sites")).toBe(1);
      expect(countRows(db, "blog_ideas")).toBe(1);
      expect(countRows(db, "blog_schedules")).toBe(1);
      expect(countRows(db, "blog_posts")).toBe(1);
      expect(countRows(db, "events")).toBeGreaterThanOrEqual(4);
      expect(countRows(db, "mission_logs")).toBeGreaterThanOrEqual(3);
      expect(countRows(db, "review_items")).toBe(2);
    });
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-blogging-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
