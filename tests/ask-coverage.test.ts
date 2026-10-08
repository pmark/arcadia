import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAskEnvelope } from "../src/ask/captureEnvelope.js";
import { ingressSourceKind } from "../src/ask/replyCapture.js";
import { buildProgram } from "../src/cli.js";
import {
  DIRECT_CHAT_NOT_MEASURED,
  renderAskCoverageSuccess,
  runAskCoverageCommand,
  type AskCoverageData,
  type AskCoverageSurface
} from "../src/commands/askCoverage.js";
import { runDecisionApproveCommand, runDecisionNewCommand } from "../src/commands/decision.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createReviewItem,
  updateReviewItemStatus,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const NOW = new Date();
const DAY = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** A workspace whose only Project has a real git repo, so Decision documents can be written and counted. */
function fixture(): { workspace: string; repoRoot: string; ingressRoot: string } {
  const root = scratch("arcadia-ask-coverage-");
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "coverage@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Coverage"], { cwd: repoRoot });
  writeFileSync(path.join(repoRoot, "README.md"), "repo\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repoRoot });
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Exercise the coverage report.", status: "active", currentMilestone: "Initial",
      nextAction: "Start", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return { workspace, repoRoot, ingressRoot: path.join(root, "ingress") };
}

function capture(workspace: string, source: string, count: number, capturedAt: Date = NOW): void {
  withDatabase(workspace, (db) => {
    for (let index = 0; index < count; index += 1) {
      const envelope = captureAskEnvelope(db, { requestId: `${source}:${capturedAt.getTime()}:${index}`, originalText: `text ${index}`, ingressSource: source });
      db.prepare("UPDATE ask_capture_envelopes SET captured_at = ? WHERE id = ?").run(capturedAt.toISOString(), envelope.id);
    }
  });
}

function sidecar(ingressRoot: string, source: string, location: "Done" | "Failed", name: string, record: Record<string, unknown>): void {
  const directory = path.join(ingressRoot, source, location);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, name), JSON.stringify(record));
}

function decideReviews(workspace: string, statuses: Array<"approved" | "rejected" | null>): void {
  withDatabase(workspace, (db) => {
    for (const status of statuses) {
      const item = createReviewItem(db, {
        decisionNeeded: "Proceed?", recommendation: null, sourceInput: "test", proposedAction: "Proceed.",
        resolvedIntent: "capture_idea", confidenceLabel: "medium", confidence: 0.5, missingFields: []
      });
      if (status) updateReviewItemStatus(db, item.id, { status, decisionNote: "ok" });
    }
  });
}

function surface(data: AskCoverageData, id: AskCoverageSurface["id"]): AskCoverageSurface {
  const found = data.surfaces.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no surface ${id}`);
  return found;
}

describe("ask show --coverage", () => {
  it("states captured over canonical per surface, reports unknown denominators, and excludes agent envelopes", () => {
    const { workspace, ingressRoot } = fixture();

    // Ingress: three processed files in the window (one skipped and one outside the window do not count).
    sidecar(ingressRoot, "iCloudIdeas", "Done", "a.response.json", { processedAt: NOW.toISOString() });
    sidecar(ingressRoot, "iCloudIdeas", "Done", "b.response.json", { processedAt: NOW.toISOString() });
    sidecar(ingressRoot, "iCloudIdeas", "Failed", "c.error.json", { status: "failed", processedAt: NOW.toISOString(), failureReason: "boom" });
    sidecar(ingressRoot, "iCloudIdeas", "Done", "skipped.response.json", { status: "skipped_empty", processedAt: NOW.toISOString() });
    sidecar(ingressRoot, "iCloudIdeas", "Done", "old.response.json", { processedAt: new Date(NOW.getTime() - 30 * DAY).toISOString() });
    capture(workspace, "ingress:iCloudIdeas", 2);

    // Discord: no independent record.
    capture(workspace, "discord.message", 2);
    capture(workspace, "discord.request", 1);

    // Review replies: two decided review items, one open; one review and one work-question reply captured.
    decideReviews(workspace, ["approved", "rejected", null]);
    capture(workspace, "operator.reply.review", 1);
    capture(workspace, "operator.reply.work-question", 1);

    // Agent-written and unclassified envelopes are never operator intake.
    capture(workspace, "agent.ask", 2);
    capture(workspace, "codex.exec", 1);
    capture(workspace, "cli.ask", 1);
    capture(workspace, "ask", 1);

    // The window ends after the review decisions above were made.
    const { data } = runAskCoverageCommand({ workspace, ingressRoot, now: new Date(Date.now() + 1000) });

    const ingress = surface(data, "ingress-files");
    expect(ingress).toMatchObject({ kind: "intake", countsAsIntake: true, captured: 2, canonical: 3, denominator: "known", coverage: 0.667 });
    expect(ingress.sources).toEqual({ "ingress:iCloudIdeas": 2 });

    const discord = surface(data, "discord");
    expect(discord).toMatchObject({ captured: 3, canonical: null, denominator: "unknown", coverage: null, countsAsIntake: true });
    expect(discord.sources).toEqual({ "discord.message": 2, "discord.request": 1 });

    const review = surface(data, "review-replies");
    expect(review).toMatchObject({ kind: "provenance", countsAsIntake: false, captured: 2, canonical: 2, denominator: "known", coverage: 1 });

    expect(data.excludedAgent).toEqual({ total: 3, bySource: { "agent.ask": 2, "codex.exec": 1 } });
    expect(data.unclassified).toEqual({ total: 2, bySource: { "cli.ask": 1, ask: 1 } });

    // The intake total is ingress alone: no provenance, agent, unclassified or unknown-denominator envelope enters it.
    expect(data.intake).toMatchObject({ surfaces: ["ingress-files"], captured: 2, canonical: 3, coverage: 0.667, capturedDenominatorUnknown: 3 });
  });

  it("counts Decision documents answered in free text as the canonical record, not offered-option answers", () => {
    const { workspace } = fixture();
    runDecisionNewCommand({ workspace, project: "demo", slug: "free", question: "What should we do?" });
    runDecisionNewCommand({
      workspace, project: "demo", slug: "pick", question: "Merge or hold?",
      options: [{ label: "Merge now", consequence: "Ships." }, { label: "Hold", consequence: "Waits." }]
    });
    runDecisionNewCommand({ workspace, project: "demo", slug: "unanswered", question: "Still open?" });
    runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer: "Do the cheap thing first." });
    runDecisionApproveCommand({ workspace, project: "demo", id: "0002", answer: "Hold" });

    const { data } = runAskCoverageCommand({ workspace, ingressRoot: "/nonexistent/arcadia-ingress", now: new Date(Date.now() + 1000) });

    const decisions = surface(data, "decision-replies");
    expect(decisions).toMatchObject({ kind: "provenance", countsAsIntake: false, captured: 1, canonical: 1, denominator: "known", coverage: 1 });
    expect(decisions.sources).toEqual({ "operator.reply.decision": 1 });
  });

  it("reports an unreadable Ingress root as unavailable rather than zero", () => {
    const { workspace } = fixture();
    capture(workspace, "ingress:iCloudIdeas", 2);

    const { data } = runAskCoverageCommand({ workspace, ingressRoot: "/nonexistent/arcadia-ingress", now: NOW });

    const ingress = surface(data, "ingress-files");
    expect(ingress).toMatchObject({ captured: 2, canonical: null, denominator: "unavailable", coverage: null });
    expect(data.intake).toMatchObject({ surfaces: [], captured: 0, canonical: 0, coverage: null, capturedDenominatorUnknown: 2 });
    expect(renderAskCoverageSuccess({ ...runAskCoverageCommand({ workspace, ingressRoot: "/nonexistent/arcadia-ingress", now: NOW }) }).join("\n"))
      .toContain("captured 2, denominator unavailable");
  });

  it("filters by window: --since as a look-back or an ISO time", () => {
    const { workspace, ingressRoot } = fixture();
    capture(workspace, "discord.message", 1, new Date(NOW.getTime() - 1 * DAY));
    capture(workspace, "discord.message", 2, new Date(NOW.getTime() - 10 * DAY));
    capture(workspace, "agent.ask", 1, new Date(NOW.getTime() - 10 * DAY));
    decideReviews(workspace, ["approved"]);

    const defaultWindow = runAskCoverageCommand({ workspace, ingressRoot, now: NOW }).data;
    expect(defaultWindow.window.since).toBe(new Date(NOW.getTime() - 7 * DAY).toISOString());
    expect(surface(defaultWindow, "discord").captured).toBe(1);
    expect(defaultWindow.excludedAgent.total).toBe(0);

    const wide = runAskCoverageCommand({ workspace, ingressRoot, since: "14d", now: NOW }).data;
    expect(surface(wide, "discord").captured).toBe(3);
    expect(wide.excludedAgent.total).toBe(1);

    const iso = runAskCoverageCommand({ workspace, ingressRoot, since: new Date(NOW.getTime() - 2 * DAY).toISOString(), now: NOW }).data;
    expect(surface(iso, "discord").captured).toBe(1);

    // A window that ends before the review decision excludes it from the canonical count.
    const later = runAskCoverageCommand({ workspace, ingressRoot, since: "1h", now: new Date(NOW.getTime() + 2 * 3_600_000) }).data;
    expect(surface(later, "review-replies").canonical).toBe(0);
    expect(surface(later, "review-replies").coverage).toBeNull();

    expect(() => runAskCoverageCommand({ workspace, ingressRoot, since: "last week", now: NOW })).toThrow(/--since/);
  });

  it("leads with the 'direct chat: not measured' headline in the data and the rendering", () => {
    const { workspace, ingressRoot } = fixture();
    capture(workspace, "discord.message", 1);

    const response = runAskCoverageCommand({ workspace, ingressRoot, now: NOW });
    expect(DIRECT_CHAT_NOT_MEASURED).toBe("direct chat: not measured");
    expect(response.data.directChat).toBe("direct chat: not measured");
    expect(response.data.headline).toContain("direct chat: not measured");
    expect(response.data.headline).toContain("not the share of all operator input");

    const lines = renderAskCoverageSuccess(response);
    expect(lines[0]).toBe(response.data.headline);
    const text = lines.join("\n");
    expect(text).toContain("Discord messages (operator intake): captured 1, denominator unknown");
    expect(text).toContain("provenance-only, not counted as intake");
    expect(text).toContain("Excluded, agent-written");
  });

  it("emits a stable --json shape from the CLI and rejects an id with --coverage", async () => {
    const { workspace, ingressRoot } = fixture();
    capture(workspace, "discord.message", 1);
    capture(workspace, "agent.ask", 1);

    const run = async (args: string[]): Promise<any> => {
      let stdout = "";
      let stderr = "";
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
      try {
        await buildProgram().parseAsync(["node", "arcadia", "ask", "show", ...args, "--workspace", workspace, "--json"]);
      } finally {
        vi.restoreAllMocks();
        process.exitCode = undefined;
      }
      return JSON.parse(stdout.trim() || stderr.trim());
    };

    const ok = await run(["--coverage", "--ingress-root", ingressRoot]);
    expect(ok.ok).toBe(true);
    expect(ok.command).toBe("ask.coverage");
    expect(Object.keys(ok.data).sort()).toEqual([
      "directChat", "excludedAgent", "headline", "intake", "notes", "schema", "surfaces", "unclassified", "window"
    ]);
    expect(ok.data.schema).toBe("arcadia-ask-coverage-v1");
    expect(ok.data.directChat).toBe("direct chat: not measured");
    expect(ok.data.surfaces.map((entry: AskCoverageSurface) => entry.id)).toEqual(["ingress-files", "discord", "review-replies", "decision-replies"]);
    expect(Object.keys(ok.data.surfaces[0]).sort()).toEqual([
      "canonical", "canonicalRecord", "captured", "countsAsIntake", "coverage", "denominator", "id", "kind", "label", "note", "sources"
    ]);
    expect(ok.data.excludedAgent).toEqual({ total: 1, bySource: { "agent.ask": 1 } });

    const withId = await run(["capture_x", "--coverage"]);
    expect(withId.ok).toBe(false);
    expect(withId.error.message).toMatch(/--coverage/);
  });

  it("classifies sources: Ingress and Discord are operator intake; agent.ask and codex.* are agent-written", () => {
    expect(ingressSourceKind("ingress:iCloudIdeas")).toBe("intake");
    expect(ingressSourceKind("discord.message")).toBe("intake");
    expect(ingressSourceKind("discord.request")).toBe("intake");
    expect(ingressSourceKind("agent.ask")).toBe("agent");
    expect(ingressSourceKind("codex.exec")).toBe("agent");
    expect(ingressSourceKind("operator.reply.decision")).toBe("provenance");
    expect(ingressSourceKind("ask")).toBeNull();
    expect(ingressSourceKind("cli.ask")).toBeNull();
    expect(ingressSourceKind("hasOwnProperty")).toBeNull();
  });
});
