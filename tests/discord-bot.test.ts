import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatInputCommandInteraction } from "discord.js";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaCli, buildCliInvocation } from "../apps/discord-bot/src/arcadia/cli.js";
import type { ExecutionRun, Milestone, WorkItem } from "../apps/discord-bot/src/arcadia/types.js";
import { loadConfig } from "../apps/discord-bot/src/config.js";
import { handleArcadiaInteraction } from "../apps/discord-bot/src/events/interactionCreate.js";
import { formatRequiresReview } from "../apps/discord-bot/src/formatters/requiresReviewFormatter.js";
import { formatRuns } from "../apps/discord-bot/src/formatters/runFormatter.js";
import { formatStatus } from "../apps/discord-bot/src/formatters/statusFormatter.js";
import { evaluateNotifications } from "../apps/discord-bot/src/notifications/poller.js";
import {
  loadNotificationState,
  saveNotificationState,
  type NotificationState
} from "../apps/discord-bot/src/notifications/state.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discord bot config", () => {
  it("validates required environment variables", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required environment variables: ARCADIA_WORKSPACE, DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID"
    );
  });

  it("loads defaults and resolves paths", () => {
    const config = loadConfig({
      ARCADIA_WORKSPACE: "./workspace",
      DISCORD_BOT_TOKEN: "token",
      DISCORD_CLIENT_ID: "client",
      DISCORD_GUILD_ID: "guild",
      DISCORD_CHANNEL_ID: "channel"
    });

    expect(config.arcadiaWorkspace).toBe(path.resolve("./workspace"));
    expect(config.arcadiaCliPath).toBeNull();
    expect(config.pollIntervalSeconds).toBe(60);
  });
});

describe("discord bot CLI adapter", () => {
  it("uses custom CLI paths without shell construction", () => {
    const invocation = buildCliInvocation(["status", "--json"], "/usr/local/bin/arcadia");

    expect(invocation.command).toBe("/usr/local/bin/arcadia");
    expect(invocation.args).toEqual(["status", "--json"]);
  });
});

describe("discord bot request command", () => {
  it("invokes arcadia ask for a mocked /arcadia request interaction", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-workspace-"));
    tempDirs.push(workspace);
    const cliPath = path.join(workspace, "fake-arcadia.mjs");
    const argvPath = path.join(workspace, "argv.json");
    const request = "Build Pinterest posting support for Rebuster.";
    writeFileSync(cliPath, fakeArcadiaCliScript(argvPath));
    chmodSync(cliPath, 0o755);
    const cli = new ArcadiaCli({ workspace, cliPath });
    let deferred = false;
    let reply = "";

    const interaction = {
      commandName: "arcadia",
      guildId: "guild",
      channelId: "channel",
      options: {
        getSubcommand: () => "request",
        getString: (name: string, required: boolean) => {
          expect(name).toBe("text");
          expect(required).toBe(true);
          return request;
        }
      },
      deferReply: async () => {
        deferred = true;
      },
      editReply: async (payload: { content: string }) => {
        reply = payload.content;
      }
    } as unknown as ChatInputCommandInteraction;

    await handleArcadiaInteraction(interaction, {
      arcadiaWorkspace: workspace,
      discordBotToken: "token",
      discordClientId: "client",
      discordGuildId: "guild",
      discordChannelId: "channel",
      arcadiaCliPath: cliPath,
      pollIntervalSeconds: 60
    }, cli);

    expect(deferred).toBe(true);
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "ask",
      "--workspace",
      workspace,
      request,
      "--json"
    ]);
    expect(reply).toContain("**Arcadia request created**");
    expect(reply).toContain("Ask: `ask_1`");
    expect(reply).toContain("Work item: `work_1`");
    expect(reply).toContain("Plan: `plan_1`");
    expect(reply).toContain("Project: Rebuster");
    expect(reply).toContain("Active milestone: Pinterest publishing support");
    expect(reply).toContain("Approval gates: 3 (credentials_required, publication, send_email_or_messages)");
    expect(reply).toContain("Codex packet: prompts/codex/codex_1/prompt.md");
    expect(reply).toContain("Repo scope: /Users/pmark/Dev/MR/Rebuster/rebuster");
  });
});

describe("discord bot formatters", () => {
  it("formats status for mobile", () => {
    const output = formatStatus({
      projectCount: 3,
      activeProjectCount: 2,
      runningWorkCount: 1,
      queuedWorkCount: 4,
      needsMarkCount: 2,
      requiresReviewCount: 2,
      autonomousCount: 1,
      codexCount: 3,
      blockedCount: 0,
      recentMissionLogCount: 2,
      recentArtifactCount: 5,
      reportPath: "/tmp/status.md"
    });

    expect(output).toContain("Active projects: 2");
    expect(output).toContain("Requires Review: 2");
    expect(output).not.toContain("Needs Mark");
  });

  it("uses Requires Review terminology for review items", () => {
    const output = formatRequiresReview([sampleWorkItem()]);

    expect(output).toContain("Arcadia Requires Review");
    expect(output).toContain("Recommended: Review the draft.");
    expect(output).not.toContain("Needs Mark");
  });

  it("does not leak internal run status terminology", () => {
    const output = formatRuns([{ ...sampleRun(), status: "needs_mark" }]);

    expect(output).toContain("Requires Review");
    expect(output).not.toContain("needs_mark");
    expect(output).not.toContain("Needs Mark");
  });
});

describe("discord bot notifications", () => {
  it("initializes silently from existing workspace state", () => {
    const evaluation = evaluateNotifications({
      requiresReviewCount: 2,
      runs: [{ ...sampleRun(), status: "failed" }],
      completedMilestones: [sampleMilestone()]
    }, null, "2026-06-10T12:00:00.000Z");

    expect(evaluation.messages).toEqual([]);
    expect(evaluation.nextState.lastRequiresReviewCount).toBe(2);
    expect(evaluation.nextState.notifiedRunIds).toEqual(["run_1"]);
    expect(evaluation.nextState.notifiedMilestoneIds).toEqual(["ms_1"]);
  });

  it("posts each notable event once", () => {
    const previous: NotificationState = {
      initializedAt: "2026-06-10T12:00:00.000Z",
      lastRequiresReviewCount: 0,
      notifiedRunIds: [],
      notifiedMilestoneIds: []
    };
    const snapshot = {
      requiresReviewCount: 1,
      runs: [{ ...sampleRun(), status: "needs_mark" }],
      completedMilestones: [sampleMilestone()]
    };

    const first = evaluateNotifications(snapshot, previous);
    const second = evaluateNotifications(snapshot, first.nextState);

    expect(first.messages.map((message) => message.key)).toEqual([
      "run:run_1",
      "requires-review:transition",
      "milestone:ms_1"
    ]);
    expect(first.messages.map((message) => message.content).join("\n")).not.toContain("Needs Mark");
    expect(second.messages).toEqual([]);
  });

  it("persists notification state atomically", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arcadia-discord-state-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "state.json");
    const state: NotificationState = {
      initializedAt: "2026-06-10T12:00:00.000Z",
      lastRequiresReviewCount: 1,
      notifiedRunIds: ["run_1"],
      notifiedMilestoneIds: ["ms_1"]
    };

    await saveNotificationState(filePath, state);

    await expect(loadNotificationState(filePath)).resolves.toEqual(state);
  });
});

function sampleWorkItem(): WorkItem {
  return {
    id: "work_1",
    title: "Approve static images",
    raw_input: "Approve static images",
    queue: "needs_mark",
    work_classification: "needs_mark",
    next_action: "Review the draft.",
    expected_artifact: "Static images",
    status: "open",
    project_name: "Rebuster",
    milestone_title: "Publishing foundation"
  };
}

function sampleRun(): ExecutionRun {
  return {
    id: "run_1",
    status: "completed",
    summary: "Run summary",
    work_item_title: "Add Pinterest publishing support",
    plan_summary: "Plan summary",
    mission_log_path: "mission_logs/run.md",
    created_at: "2026-06-10T12:00:00.000Z",
    updated_at: "2026-06-10T12:00:00.000Z",
    steps: [
      {
        status: "needs_mark",
        plan_step_title: "Approve Static Images",
        output: "Approval required",
        error: null
      }
    ],
    artifacts: [{ id: "art_1", title: "Static Images", path: "artifacts/static.md" }]
  };
}

function sampleMilestone(): Milestone {
  return {
    id: "ms_1",
    project_id: "proj_1",
    project_name: "Rebuster",
    title: "Cross-platform publishing foundation",
    status: "completed",
    created_at: "2026-06-10T12:00:00.000Z",
    updated_at: "2026-06-10T12:00:00.000Z"
  };
}

function fakeArcadiaCliScript(argvPath: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args));
const workspace = args[args.indexOf("--workspace") + 1];
const request = args[args.indexOf("--workspace") + 2];

process.stdout.write(JSON.stringify({
  ok: true,
  command: "ask",
  workspace,
  data: {
    ask: {
      id: "ask_1",
      raw_request: request,
      resolved_intent: "codex_plan",
      prompt_packet_path: "prompts/codex/codex_1/prompt.md",
      status: "planned"
    },
    resolvedIntent: {
      intentId: "codex_plan",
      matched: false,
      outputKind: "codex_planning_packet",
      workClassification: "codex"
    },
    workItem: {
      id: "work_1",
      title: request,
      raw_input: request,
      project_id: "proj_rebuster",
      milestone_id: "ms_pinterest",
      queue: "work_queue",
      work_classification: "codex",
      next_action: "Review the Codex planning packet for this request.",
      expected_artifact: "Codex planning packet",
      status: "open",
      project_name: "Rebuster",
      milestone_title: "Pinterest publishing support"
    },
    plan: {
      id: "plan_1",
      status: "planned",
      summary: "Intent plan."
    },
    approvalGates: [
      {
        id: "gate_1",
        gate_type: "credentials_required",
        reason: "Pinterest API credentials are required before posting work.",
        status: "pending"
      },
      {
        id: "gate_2",
        gate_type: "publication",
        reason: "Publishing boundaries require approval.",
        status: "pending"
      },
      {
        id: "gate_3",
        gate_type: "send_email_or_messages",
        reason: "Posting to social channels requires approval.",
        status: "pending"
      }
    ],
    codexInvocations: [{
      id: "codex_1",
      purpose: "build",
      workspace_scope: "/Users/pmark/Dev/MR/Rebuster/rebuster",
      prompt_path: "prompts/codex/codex_1/prompt.md",
      status: "packet_created"
    }],
    run: null
  },
  artifacts: [],
  warnings: []
}));
`;
}
