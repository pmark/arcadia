import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatInputCommandInteraction } from "discord.js";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaCli, buildCliInvocation } from "../apps/discord-bot/src/arcadia/cli.js";
import type {
  ArcadiaJsonSuccess,
  AskData,
  CodexTask,
  ExecutionRun,
  Milestone,
  ReviewDecisionData,
  ReviewItem,
  RunShowData,
  WorkItem
} from "../apps/discord-bot/src/arcadia/types.js";
import { loadConfig } from "../apps/discord-bot/src/config.js";
import { handleArcadiaInteraction } from "../apps/discord-bot/src/events/interactionCreate.js";
import { handleArcadiaMessage } from "../apps/discord-bot/src/events/messageCreate.js";
import { buildArcadiaCommand } from "../apps/discord-bot/src/commands/register.js";
import { formatCodexTasks } from "../apps/discord-bot/src/formatters/codexFormatter.js";
import {
  formatRequiresReview,
  formatRequiresReviewDecision,
  formatRequiresReviewShow
} from "../apps/discord-bot/src/formatters/requiresReviewFormatter.js";
import { formatRunDetail, formatRuns } from "../apps/discord-bot/src/formatters/runFormatter.js";
import { formatStatus } from "../apps/discord-bot/src/formatters/statusFormatter.js";
import { evaluateNotifications } from "../apps/discord-bot/src/notifications/poller.js";
import {
  discordSubmissionStatePath,
  loadDiscordSubmissionState,
  loadNotificationState,
  recordDiscordSubmission,
  recordReviewMessage,
  reviewMessageStatePath,
  saveNotificationState,
  type NotificationState
} from "../apps/discord-bot/src/notifications/state.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discord bot config", () => {
  it("validates required environment variables", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID"
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

describe("discord slash command registration", () => {
  it("aligns Requires Review commands with the CLI review actions", () => {
    const command = buildArcadiaCommand() as { options: Array<{ name: string }> };
    const subcommands = command.options.map((option) => option.name);

    expect(subcommands).toEqual(expect.arrayContaining([
      "review",
      "review-show",
      "review-approve",
      "review-reject",
      "review-defer"
    ]));
    expect(subcommands).not.toContain("requires-review");
  });

  it("documents slash command reset scripts", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("apps", "discord-bot", "package.json"), "utf8"));
    const readme = readFileSync(path.resolve("apps", "discord-bot", "README.md"), "utf8");

    expect(packageJson.scripts.register).toBe("tsx src/commands/register.ts");
    expect(packageJson.scripts.unregister).toBe("tsx src/commands/register.ts unregister");
    expect(packageJson.scripts.reregister).toBe("tsx src/commands/register.ts reregister");
    expect(readme).toContain("pnpm --filter arcadia-discord-bot unregister");
    expect(readme).toContain("pnpm --filter arcadia-discord-bot reregister");
    expect(readme).toContain("/arcadia review-approve");
    expect(readme).not.toContain("/arcadia requires-review");
  });
});

describe("discord bot CLI adapter", () => {
  it("uses custom CLI paths without shell construction", () => {
    const invocation = buildCliInvocation(["status", "--json"], "/usr/local/bin/arcadia");

    expect(invocation.command).toBe("/usr/local/bin/arcadia");
    expect(invocation.args).toEqual(["status", "--json"]);
  });

  it("invokes arcadia run show with the configured workspace", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-workspace-"));
    tempDirs.push(workspace);
    const cliPath = path.join(workspace, "fake-arcadia-run.mjs");
    const argvPath = path.join(workspace, "argv.json");
    writeFileSync(cliPath, fakeArcadiaRunShowCliScript(argvPath));
    chmodSync(cliPath, 0o755);

    const response = await new ArcadiaCli({ workspace, cliPath }).run("run_1");

    expect(response.data.run.id).toBe("run_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "run",
      "show",
      "run_1",
      "--workspace",
      workspace,
      "--json"
    ]);
  });

  it("invokes arcadia review actions with the configured workspace", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-workspace-"));
    tempDirs.push(workspace);
    const cliPath = path.join(workspace, "fake-arcadia-review.mjs");
    const argvPath = path.join(workspace, "argv.json");
    writeFileSync(cliPath, fakeArcadiaReviewCliScript(argvPath));
    chmodSync(cliPath, 0o755);
    const cli = new ArcadiaCli({ workspace, cliPath });

    await cli.review();
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual(["review", "--workspace", workspace, "--json"]);

    await cli.reviewShow("review_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "review",
      "show",
      "review_1",
      "--workspace",
      workspace,
      "--json"
    ]);

    await cli.reviewApprove("review_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "review",
      "approve",
      "review_1",
      "--workspace",
      workspace,
      "--json"
    ]);

    await cli.reviewReject("review_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "review",
      "reject",
      "review_1",
      "--workspace",
      workspace,
      "--json"
    ]);

    await cli.reviewDefer("review_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "review",
      "defer",
      "review_1",
      "--workspace",
      workspace,
      "--json"
    ]);

    await cli.reviewResolveReply("A", "review_1");
    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "review",
      "resolve-reply",
      "A",
      "--id",
      "review_1",
      "--workspace",
      workspace,
      "--json"
    ]);
  });

  it("invokes arcadia codex list for a mocked /arcadia codex interaction", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-workspace-"));
    tempDirs.push(workspace);
    const cliPath = path.join(workspace, "fake-arcadia-codex.mjs");
    const argvPath = path.join(workspace, "argv.json");
    writeFileSync(cliPath, fakeArcadiaCodexCliScript(argvPath));
    chmodSync(cliPath, 0o755);
    const cli = new ArcadiaCli({ workspace, cliPath });
    let reply = "";

    const interaction = {
      commandName: "arcadia",
      guildId: "guild",
      channelId: "channel",
      options: {
        getSubcommand: () => "codex"
      },
      deferReply: async () => {},
      editReply: async (message: { content: string }) => {
        reply = message.content;
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

    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "codex",
      "list",
      "--workspace",
      workspace,
      "--active-only",
      "--json"
    ]);
    expect(reply).toContain("**Codex Companion**");
    expect(reply).toContain("Project: Rebuster");
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
        },
        getBoolean: (name: string) => {
          expect(name).toBe("run-safe");
          return false;
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
      "--source-ingress",
      "discord.request",
      "--json"
    ]);
    expect(reply).toContain("**Arcadia request created**");
    expect(reply).toContain("Ask: `ask_1`");
    expect(reply).toContain("Work item: `work_1`");
    expect(reply).toContain("Plan: `plan_1`");
    expect(reply).toContain("Run: Not run");
    expect(reply).toContain("Project: Rebuster");
    expect(reply).toContain("Active milestone: Pinterest publishing support");
    expect(reply).toContain("Approval gates: 3 (credentials_required, publication, send_email_or_messages)");
    expect(reply).toContain("Codex packet: prompts/codex/codex_1/prompt.md");
    expect(reply).toContain("Repo scope: /Users/pmark/Dev/MR/Rebuster/rebuster");
    await expect(loadDiscordSubmissionState(discordSubmissionStatePath(workspace))).resolves.toMatchObject({
      submittedAskIds: ["ask_1"],
      submittedWorkItemIds: ["work_1"],
      submittedRunIds: []
    });
  });

  it("can run deterministic safe steps when requested from Discord", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-workspace-"));
    tempDirs.push(workspace);
    const cliPath = path.join(workspace, "fake-arcadia.mjs");
    const argvPath = path.join(workspace, "argv.json");
    const request = "Prepare a weekly Martian Rover Labs update from recent mission logs.";
    writeFileSync(cliPath, fakeArcadiaCliScript(argvPath));
    chmodSync(cliPath, 0o755);
    const cli = new ArcadiaCli({ workspace, cliPath });
    let reply = "";

    const interaction = {
      commandName: "arcadia",
      guildId: "guild",
      channelId: "channel",
      options: {
        getSubcommand: () => "request",
        getString: () => request,
        getBoolean: (name: string) => {
          expect(name).toBe("run-safe");
          return true;
        }
      },
      deferReply: async () => {},
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

    expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
      "ask",
      "--workspace",
      workspace,
      request,
      "--source-ingress",
      "discord.request",
      "--run-safe",
      "--json"
    ]);
    expect(reply).toContain("Run: `run_1` completed");
    expect(reply).toContain("Run detail: /arcadia run id:run_1");
    await expect(loadDiscordSubmissionState(discordSubmissionStatePath(workspace))).resolves.toMatchObject({
      submittedAskIds: ["ask_1"],
      submittedWorkItemIds: ["work_1"],
      submittedRunIds: ["run_1"]
    });
  });
});

describe("discord bot run command", () => {
  it("shows one run with mission log, artifacts, and review reason", async () => {
    let requestedRunId = "";
    let reply = "";
    const cli = {
      run: async (runId: string): Promise<ArcadiaJsonSuccess<RunShowData>> => {
        requestedRunId = runId;
        return runShowResponse({
          ...sampleRun(),
          status: "requires_review"
        }, ["Approval required"]);
      }
    } as unknown as ArcadiaCli;
    const interaction = {
      commandName: "arcadia",
      guildId: "guild",
      channelId: "channel",
      options: {
        getSubcommand: () => "run",
        getString: (name: string, required: boolean) => {
          expect(name).toBe("id");
          expect(required).toBe(true);
          return "run_1";
        }
      },
      deferReply: async () => {},
      editReply: async (payload: { content: string }) => {
        reply = payload.content;
      }
    } as unknown as ChatInputCommandInteraction;

    await handleArcadiaInteraction(interaction, {
      arcadiaWorkspace: "/tmp/workspace",
      discordBotToken: "token",
      discordClientId: "client",
      discordGuildId: "guild",
      discordChannelId: "channel",
      arcadiaCliPath: null,
      pollIntervalSeconds: 60
    }, cli);

    expect(requestedRunId).toBe("run_1");
    expect(reply).toContain("**Arcadia run detail**");
    expect(reply).toContain("Run: `run_1`");
    expect(reply).toContain("Status: Requires Review");
    expect(reply).toContain("Mission log: mission_logs/run.md");
    expect(reply).toContain("Artifacts: Static Images (artifacts/static.md)");
    expect(reply).toContain("Reason: Approval required");
    expect(reply).not.toContain("requires_review");
  });
});

describe("discord bot end-to-end fixture", () => {
  it("submits the Rebuster request, verifies packet context, runs safe work, and evaluates notifications", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-e2e-"));
    tempDirs.push(workspace);
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Help users turn product evidence into better shipping decisions.",
        status: "active",
        currentMilestone: "Pinterest publishing support",
        nextAction: "Define Pinterest posting support boundaries.",
        expectedArtifact: "Pinterest implementation plan",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: ["Rebuster", "rebuster app"],
        repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
        statusSummary: "Active product repository with posting automation work in scope.",
        validationCommands: ["pnpm test", "pnpm lint"]
      });
    });
    const cli = new ArcadiaCli({ workspace, cliPath: null, timeoutMs: 60_000 });

    const rebusterReply = await invokeArcadiaInteraction(cli, workspace, {
      subcommand: "request",
      text: "Build Pinterest posting support for Rebuster.",
      runSafe: true
    });

    const rebusterReviewId = extractBacktickedValue(rebusterReply, "Requires Review");
    expect(rebusterReply).toContain("Result: Requires Review item created.");
    expect(rebusterReply).toContain("Decision: Pinterest posting support for Rebuster.");

    const approved = runReviewApproveCommand({ workspace, id: rebusterReviewId });
    const rebusterWorkId = approved.data.approval?.workItem?.id ?? "";
    expect(rebusterWorkId).toMatch(/^work_/);

    const packet = withDatabase(workspace, (db) => {
      const gates = listApprovalGatesForWorkItem(db, rebusterWorkId);
      const invocation = listCodexInvocationsForWorkItem(db, rebusterWorkId)[0];
      return { gates, invocation };
    });
    expect(new Set(packet.gates.map((gate) => gate.gate_type))).toEqual(
      new Set(["credentials_required", "destructive_filesystem_changes", "publication", "send_email_or_messages"])
    );
    const prompt = readFileSync(path.join(workspace, packet.invocation.prompt_path), "utf8");
    expect(prompt).toContain("Target repository: /Users/pmark/Dev/MR/Rebuster/rebuster");
    expect(prompt).toContain("Active milestone: Pinterest publishing support");
    expect(prompt).toContain("Validation commands: pnpm test && pnpm lint");
    expect(prompt).toContain("credential access, publication, and social posting/messaging require explicit approval");

    const weeklyReply = await invokeArcadiaInteraction(cli, workspace, {
      subcommand: "request",
      text: "Prepare a weekly Martian Rover Labs update from recent mission logs.",
      runSafe: true
    });
    expect(extractBacktickedValue(weeklyReply, "Requires Review")).toMatch(/^review_/);
    expect(weeklyReply).toContain("Stewardship: Project Work -> Clarify First");
    expect(weeklyReply).toContain("Result: Requires Review item created.");

    const submissions = await loadDiscordSubmissionState(discordSubmissionStatePath(workspace));
    expect(submissions.submittedRunIds).toEqual([]);

    const [status, review, runs] = await Promise.all([cli.status(), cli.review(), cli.runs(10)]);
    const evaluation = evaluateNotifications({
      requiresReviewCount: status.data.requiresReviewCount,
      reviewItems: review.data.items,
      blockedWorkItems: [],
      runs: runs.data.runs,
      completedMilestones: [],
      codexTasks: []
    }, {
      initializedAt: "2026-06-10T12:00:00.000Z",
      lastRequiresReviewCount: 0,
      notifiedReviewItemIds: [],
      notifiedRunIds: [],
      notifiedMilestoneIds: [],
      notifiedBlockedWorkItemIds: [],
      notifiedArtifactIds: [],
      codexTaskStatuses: {},
      notifiedCodexTaskEvents: []
    }, "2026-06-10T12:05:00.000Z", submissions);

    expect(evaluation.messages.map((message) => message.key).some((key) => key.startsWith("requires-review:"))).toBe(true);
    expect(evaluation.messages.map((message) => message.content).join("\n")).toContain("Reply with A, B, C");
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

  it("formats active Codex tasks for Discord", () => {
    const output = formatCodexTasks({
      observedCount: 1,
      missionLogPaths: [],
      tasks: [{ ...sampleCodexTask(), status: "active" }]
    });

    expect(output).toContain("**Codex Companion**");
    expect(output).toContain("Active tasks: 1");
    expect(output).toContain("Project: Rebuster");
    expect(output).toContain("Task: ctask_1");
  });

  it("uses Requires Review terminology for review items", () => {
    const output = formatRequiresReview([sampleReviewItem()]);

    expect(output).toContain("Arcadia Requires Review");
    expect(output).toContain("R1 - Requires Review");
    expect(output).toContain("A) Approve");
    expect(output).toContain("Reply with A, B, C, approve, reject, defer.");
    expect(output).not.toContain("Needs Mark");
  });

  it("formats Requires Review details and decisions for Discord", () => {
    const detail = formatRequiresReviewShow(sampleReviewItem());
    expect(detail).toContain("ID: `review_1`");
    expect(detail).toContain("Actions: approve, reject, defer");

    const decision = formatRequiresReviewDecision(sampleReviewDecision());
    expect(decision).toContain("Requires Review approved");
    expect(decision).toContain("Review: `R1`");
    expect(decision).toContain("Resumed ask: `ask_2`");
    expect(decision).toContain("Work item: `work_2`");
  });

  it("does not leak internal run status terminology", () => {
    const output = formatRuns([{ ...sampleRun(), status: "requires_review" }]);

    expect(output).toContain("Requires Review");
    expect(output).not.toContain("requires_review");
    expect(output).not.toContain("Needs Mark");
  });

  it("formats detailed run status for remote review", () => {
    const output = formatRunDetail(runShowResponse({ ...sampleRun(), status: "failed" }, []).data);

    expect(output).toContain("Status: failed");
    expect(output).toContain("Mission log: mission_logs/run.md");
    expect(output).toContain("Artifacts: Static Images (artifacts/static.md)");
    expect(output).toContain("Blocking step: Approve Static Images");
    expect(output).toContain("Final reporting depends on completed validation artifacts.");
  });
});

describe("discord review reply handling", () => {
  it("routes direct replies through ask with review metadata", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-discord-state-"));
    tempDirs.push(workspace);
    await recordReviewMessage(reviewMessageStatePath(workspace), {
      reviewId: "review_1",
      reviewSlug: "R1",
      channelId: "channel",
      messageId: "message_1",
      createdAt: "2026-06-10T12:00:00.000Z"
    });
    let calledWith: { request: string; replyReviewId?: string | null; sourceIngress?: string } | null = null;
    let reply = "";
    const cli = {
      ask: async (request: string, options?: { replyReviewId?: string | null; sourceIngress?: string }) => {
        calledWith = { request, replyReviewId: options?.replyReviewId, sourceIngress: options?.sourceIngress };
        return askResponse({
          workspace,
          request,
          resultSummary: "R1 approved. Resuming execution.",
          reviewItemId: "review_1"
        });
      }
    } as unknown as ArcadiaCli;

    await handleArcadiaMessage(fakeMessage({
      content: "A",
      referenceMessageId: "message_1",
      reply: async (content: string) => {
        reply = content;
      }
    }), testConfig(workspace), cli);

    expect(calledWith).toEqual({ request: "A", replyReviewId: "review_1", sourceIngress: "discord.message" });
    expect(reply).toContain("**Arcadia ask handled**");
    expect(reply).toContain("Result: R1 approved. Resuming execution.");
  });

  it("routes slug fallback through ask without Discord-specific parsing", async () => {
    let calledWith: { request: string; replyReviewId?: string | null; sourceIngress?: string } | null = null;
    const cli = {
      ask: async (request: string, options?: { replyReviewId?: string | null; sourceIngress?: string }) => {
        calledWith = { request, replyReviewId: options?.replyReviewId, sourceIngress: options?.sourceIngress };
        return askResponse({
          workspace: "/tmp/workspace",
          request,
          resultSummary: "R1 deferred.",
          reviewItemId: "review_1"
        });
      }
    } as unknown as ArcadiaCli;

    await handleArcadiaMessage(fakeMessage({ content: "R1 defer" }), testConfig("/tmp/workspace"), cli);

    expect(calledWith).toEqual({ request: "R1 defer", replyReviewId: null, sourceIngress: "discord.message" });
  });

  it("routes plain natural messages through ask", async () => {
    let calledWith: { request: string; replyReviewId?: string | null; sourceIngress?: string } | null = null;
    let reply = "";
    const cli = {
      ask: async (request: string, options?: { replyReviewId?: string | null; sourceIngress?: string }) => {
        calledWith = { request, replyReviewId: options?.replyReviewId, sourceIngress: options?.sourceIngress };
        return askResponse({
          workspace: "/tmp/workspace",
          request,
          resultSummary: "Requires Review item created.",
          reviewItemId: "review_1"
        });
      }
    } as unknown as ArcadiaCli;

    await handleArcadiaMessage(fakeMessage({
      content: "Implement Rebuster Pinterest publishing",
      reply: async (content: string) => {
        reply = content;
      }
    }), testConfig("/tmp/workspace"), cli);

    expect(calledWith).toEqual({
      request: "Implement Rebuster Pinterest publishing",
      replyReviewId: null,
      sourceIngress: "discord.message"
    });
    expect(reply).toContain("Result: Requires Review item created.");
  });
});

describe("discord bot notifications", () => {
  it("initializes silently from existing workspace state", () => {
    const evaluation = evaluateNotifications({
      requiresReviewCount: 2,
      runs: [{ ...sampleRun(), status: "failed" }],
      completedMilestones: [sampleMilestone()],
      codexTasks: [{ ...sampleCodexTask(), status: "active" }]
    }, null, "2026-06-10T12:00:00.000Z");

    expect(evaluation.messages).toEqual([]);
    expect(evaluation.nextState.lastRequiresReviewCount).toBe(2);
    expect(evaluation.nextState.notifiedRunIds).toEqual(["run_1"]);
    expect(evaluation.nextState.notifiedMilestoneIds).toEqual(["ms_1"]);
    expect(evaluation.nextState.codexTaskStatuses.ctask_1).toBe("active");
  });

  it("posts each notable event once", () => {
    const previous: NotificationState = emptyNotificationStateForTest();
    const snapshot = {
      requiresReviewCount: 1,
      runs: [{ ...sampleRun(), status: "requires_review" }],
      completedMilestones: [sampleMilestone()],
      codexTasks: []
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

  it("suppresses routine completed run notices while still surfacing artifacts", () => {
    const previous: NotificationState = emptyNotificationStateForTest();
    const evaluation = evaluateNotifications({
      requiresReviewCount: 0,
      runs: [{ ...sampleRun(), status: "completed" }],
      completedMilestones: [],
      codexTasks: []
    }, previous);

    expect(evaluation.messages).toHaveLength(1);
    expect(evaluation.messages[0].key).toBe("artifact:art_1");
    expect(evaluation.messages[0].content).toContain("Artifact produced: Static Images");
    expect(evaluation.nextState.notifiedRunIds).toEqual([]);
  });

  it("posts completed runs once when they originated from Discord", () => {
    const previous: NotificationState = emptyNotificationStateForTest();
    const submissions = {
      submittedAskIds: ["ask_1"],
      submittedWorkItemIds: ["work_1"],
      submittedRunIds: [],
      updatedAt: "2026-06-10T12:00:00.000Z"
    };
    const snapshot = {
      requiresReviewCount: 0,
      runs: [{ ...sampleRun(), status: "completed" }],
      completedMilestones: [],
      codexTasks: []
    };

    const first = evaluateNotifications(snapshot, previous, "2026-06-10T12:05:00.000Z", submissions);
    const second = evaluateNotifications(snapshot, first.nextState, "2026-06-10T12:06:00.000Z", submissions);

    expect(first.messages).toHaveLength(2);
    expect(first.messages[0].key).toBe("run:run_1");
    expect(first.messages[0].content).toContain("**Arcadia run completed**");
    expect(first.messages[0].content).toContain("Run detail: /arcadia run id:run_1");
    expect(first.messages[1].key).toBe("artifact:art_1");
    expect(first.messages[1].content).toContain("Artifact produced: Static Images");
    expect(first.nextState.notifiedRunIds).toEqual(["run_1"]);
    expect(second.messages).toEqual([]);
  });

  it("posts Codex task transition notifications once", () => {
    const previous: NotificationState = {
      ...emptyNotificationStateForTest(),
      codexTaskStatuses: { ctask_1: "active" }
    };
    const snapshot = {
      requiresReviewCount: 0,
      runs: [],
      completedMilestones: [],
      codexTasks: [{ ...sampleCodexTask(), status: "complete", mission_log_path: "mission_logs/codex.md" }]
    };

    const first = evaluateNotifications(snapshot, previous);
    const second = evaluateNotifications(snapshot, first.nextState);

    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].key).toBe("codex:ctask_1:completed");
    expect(first.messages[0].content).toContain("**Codex task completed**");
    expect(first.messages[0].content).toContain("Mission log: mission_logs/codex.md");
    expect(second.messages).toEqual([]);
  });

  it("posts Codex started, requires-review, and failed notifications", () => {
    const started = evaluateNotifications({
      requiresReviewCount: 0,
      runs: [],
      completedMilestones: [],
      codexTasks: [{ ...sampleCodexTask(), status: "active" }]
    }, emptyNotificationStateForTest());
    expect(started.messages[0].key).toBe("codex:ctask_1:started");

    const requiresReview = evaluateNotifications({
      requiresReviewCount: 0,
      runs: [],
      completedMilestones: [],
      codexTasks: [{ ...sampleCodexTask(), status: "blocked" }]
    }, { ...emptyNotificationStateForTest(), codexTaskStatuses: { ctask_1: "active" } });
    expect(requiresReview.messages[0].key).toBe("codex:ctask_1:requires_review");

    const failed = evaluateNotifications({
      requiresReviewCount: 0,
      runs: [],
      completedMilestones: [],
      codexTasks: [{ ...sampleCodexTask(), status: "failed" }]
    }, { ...emptyNotificationStateForTest(), codexTaskStatuses: { ctask_1: "active" } });
    expect(failed.messages[0].key).toBe("codex:ctask_1:failed");
  });

  it("persists notification state atomically", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arcadia-discord-state-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "state.json");
    const state: NotificationState = {
      ...emptyNotificationStateForTest(),
      lastRequiresReviewCount: 1,
      notifiedRunIds: ["run_1"],
      notifiedMilestoneIds: ["ms_1"],
      codexTaskStatuses: { ctask_1: "active" },
      notifiedCodexTaskEvents: ["ctask_1:started"]
    };

    await saveNotificationState(filePath, state);

    await expect(loadNotificationState(filePath)).resolves.toEqual(state);
  });

  it("records Discord submissions separately from notification initialization", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arcadia-discord-state-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "submissions.json");

    await recordDiscordSubmission(filePath, { askId: "ask_1", workItemId: "work_1", runId: null });
    await recordDiscordSubmission(filePath, { askId: "ask_1", workItemId: "work_1", runId: "run_1" });

    await expect(loadDiscordSubmissionState(filePath)).resolves.toMatchObject({
      submittedAskIds: ["ask_1"],
      submittedWorkItemIds: ["work_1"],
      submittedRunIds: ["run_1"]
    });
  });
});

async function invokeArcadiaInteraction(
  cli: ArcadiaCli,
  workspace: string,
  options: { subcommand: "request"; text: string; runSafe: boolean }
): Promise<string> {
  let reply = "";
  const interaction = {
    commandName: "arcadia",
    guildId: "guild",
    channelId: "channel",
    options: {
      getSubcommand: () => options.subcommand,
      getString: (name: string, required: boolean) => {
        expect(name).toBe("text");
        expect(required).toBe(true);
        return options.text;
      },
      getBoolean: (name: string) => {
        expect(name).toBe("run-safe");
        return options.runSafe;
      }
    },
    deferReply: async () => {},
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
    arcadiaCliPath: null,
    pollIntervalSeconds: 60
  }, cli);

  return reply;
}

function testConfig(workspace: string) {
  return {
    arcadiaWorkspace: workspace,
    discordBotToken: "token",
    discordClientId: "client",
    discordGuildId: "guild",
    discordChannelId: "channel",
    arcadiaCliPath: null,
    pollIntervalSeconds: 60
  };
}

function fakeMessage(options: {
  content: string;
  referenceMessageId?: string;
  reply?: (content: string) => Promise<void>;
}) {
  return {
    content: options.content,
    guildId: "guild",
    channelId: "channel",
    author: { bot: false },
    reference: options.referenceMessageId ? { messageId: options.referenceMessageId } : null,
    reply: options.reply ?? (async () => {})
  } as never;
}

function extractBacktickedValue(output: string, label: string): string {
  const match = new RegExp(`${label}: \`([^\`]+)\``).exec(output);
  if (!match?.[1]) {
    throw new Error(`Expected ${label} in output: ${output}`);
  }
  return match[1];
}

function sampleWorkItem(): WorkItem {
  return {
    id: "work_1",
    title: "Approve static images",
    raw_input: "Approve static images",
    queue: "requires_review",
    work_classification: "requires_review",
    next_action: "Review the draft.",
    expected_artifact: "Static images",
    status: "open",
    project_name: "Rebuster",
    milestone_title: "Publishing foundation"
  };
}

function sampleReviewItem(): ReviewItem {
  return {
    id: "review_1",
    slug: "R1",
    workItemId: null,
    project: "Rebuster",
    goal: "Ship Pinterest publishing support.",
    decisionNeeded: "Approve or reject this proposed Arcadia action.",
    context: "CreateWork: Build Pinterest posting support",
    recommendation: "Approve only if the project, goal, and action match your intent.",
    options: ["approve", "reject", "defer"],
    sourceInput: "Build Pinterest posting support for Rebuster.",
    resultingAskRequestId: null
  };
}

function sampleReviewDecision(): ReviewDecisionData {
  return {
    item: {
      ...sampleReviewItem(),
      resultingAskRequestId: "ask_2"
    },
    result: {
      status: "approved",
      summary: "Work item created."
    },
    approval: {
      ask: {
        id: "ask_2",
        raw_request: "Build Pinterest posting support for Rebuster.",
        resolved_intent: "CreateWork",
        prompt_packet_path: null,
        status: "planned"
      },
      resolvedIntent: {
        intentId: "CreateWork",
        matched: true,
        outputKind: "codex_build_packet",
        workClassification: "codex"
      },
      workItem: {
        ...sampleWorkItem(),
        id: "work_2",
        queue: "work_queue",
        work_classification: "codex"
      },
      plan: null,
      approvalGates: [],
      codexInvocations: [],
      run: null,
      reviewItemId: null
    }
  };
}

function sampleRun(): ExecutionRun {
  return {
    id: "run_1",
    work_item_id: "work_1",
    status: "completed",
    summary: "Run summary",
    work_item_title: "Add Pinterest publishing support",
    plan_summary: "Plan summary",
    mission_log_path: "mission_logs/run.md",
    created_at: "2026-06-10T12:00:00.000Z",
    updated_at: "2026-06-10T12:00:00.000Z",
    steps: [
      {
        status: "requires_review",
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

function sampleCodexTask(): CodexTask {
  return {
    id: "ctask_1",
    source: "local_goal",
    source_task_id: "thread_1",
    title: "Implement Codex Companion",
    status: "active",
    url: null,
    summary: "Implement Arcadia Codex Companion.",
    project_id: "proj_1",
    milestone_id: "ms_1",
    mission_log_id: null,
    project_name: "Rebuster",
    milestone_title: "Codex Companion",
    mission_log_path: null,
    last_observed_at: "2026-06-10T12:00:00.000Z"
  };
}

function emptyNotificationStateForTest(): NotificationState {
  return {
    initializedAt: "2026-06-10T12:00:00.000Z",
    lastRequiresReviewCount: 0,
    notifiedReviewItemIds: [],
    notifiedRunIds: [],
    notifiedMilestoneIds: [],
    notifiedBlockedWorkItemIds: [],
    notifiedArtifactIds: [],
    codexTaskStatuses: {},
    notifiedCodexTaskEvents: []
  };
}

function runShowResponse(run: ExecutionRun, needsMark: string[]): ArcadiaJsonSuccess<RunShowData> {
  return {
    ok: true,
    command: "run.show",
    workspace: "/tmp/workspace",
    data: { run, needsMark },
    artifacts: [
      ...(run.mission_log_path ? [run.mission_log_path] : []),
      ...run.artifacts.flatMap((artifact) => artifact.path ? [artifact.path] : [])
    ],
    warnings: []
  };
}

function askResponse(input: {
  workspace: string;
  request: string;
  resultSummary: string;
  reviewItemId?: string | null;
}): ArcadiaJsonSuccess<AskData> {
  return {
    ok: true,
    command: "ask",
    workspace: input.workspace,
    data: {
      ask: {
        id: "ask_1",
        raw_request: input.request,
        resolved_intent: "ReviewResponse",
        prompt_packet_path: null,
        status: "planned"
      },
      intake: {
        resolvedIntent: "ReviewResponse",
        classification: "ReviewResponse",
        confidence: 0.96,
        confidenceLabel: "high",
        proposedAction: input.request,
        suggestedNextStep: null
      },
      resolvedIntent: {
        intentId: "ReviewResponse",
        matched: true,
        outputKind: "review_response",
        workClassification: "autonomous"
      },
      result: {
        status: "acted",
        summary: input.resultSummary
      },
      workItem: null,
      plan: null,
      approvalGates: [],
      codexInvocations: [],
      run: null,
      reviewItemId: input.reviewItemId ?? null,
      backBurnerItemId: null
    },
    artifacts: [],
    warnings: []
  };
}

function fakeArcadiaCliScript(argvPath: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args));
const workspace = args[args.indexOf("--workspace") + 1];
const request = args[args.indexOf("--workspace") + 2];
const runSafe = args.includes("--run-safe");

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
    run: runSafe ? {
      id: "run_1",
      work_item_id: "work_1",
      status: "completed",
      summary: "Run summary",
      work_item_title: request,
      plan_summary: "Intent plan.",
      mission_log_path: "mission_logs/run.md",
      created_at: "2026-06-10T12:00:00.000Z",
      updated_at: "2026-06-10T12:00:00.000Z",
      steps: [],
      artifacts: []
    } : null
  },
  artifacts: [],
  warnings: []
}));
`;
}

function fakeArcadiaRunShowCliScript(argvPath: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args));

process.stdout.write(JSON.stringify({
  ok: true,
  command: "run.show",
  workspace: args[args.indexOf("--workspace") + 1],
  data: {
    run: {
      id: "run_1",
      work_item_id: "work_1",
      status: "completed",
      summary: "Run summary",
      work_item_title: "Add Pinterest publishing support",
      plan_summary: "Plan summary",
      mission_log_path: "mission_logs/run.md",
      created_at: "2026-06-10T12:00:00.000Z",
      updated_at: "2026-06-10T12:00:00.000Z",
      steps: [],
      artifacts: []
    },
    needsMark: []
  },
  artifacts: [],
  warnings: []
}));
`;
}

function fakeArcadiaReviewCliScript(argvPath: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args));
const workspace = args[args.indexOf("--workspace") + 1];
const id = args.includes("review_1") ? "review_1" : null;
const item = {
  id: id ?? "review_1",
  slug: "R1",
  workItemId: null,
  project: "Arcadia",
  goal: "Dogfood Arcadia.",
  decisionNeeded: "Approve or reject this proposed Arcadia action.",
  context: "CreateWork: Build the thing",
  recommendation: "Approve only if this matches your intent.",
  options: ["approve", "reject", "defer"],
  sourceInput: "Build the thing",
  resultingAskRequestId: args.includes("approve") ? "ask_2" : null
};
const data = args.includes("show")
  ? { item }
  : args.includes("resolve-reply")
    ? {
        item,
        action: "approved",
        selectedOption: "approve",
        feedback: null,
        result: { status: "approved", summary: "Work item created." },
        approval: null,
        confirmation: "R1 approved. Resuming execution."
      }
  : args.includes("approve") || args.includes("reject") || args.includes("defer")
    ? {
        item,
        result: {
          status: args.includes("approve") ? "approved" : args.includes("reject") ? "rejected" : "deferred",
          summary: args.includes("approve") ? "Work item created." : "Decision recorded."
        },
        approval: args.includes("approve") ? { ask: { id: "ask_2" }, workItem: { id: "work_1" } } : null
      }
    : { count: 1, items: [item] };

process.stdout.write(JSON.stringify({
  ok: true,
  command: "review",
  workspace,
  data,
  artifacts: [],
  warnings: []
}));
`;
}

function fakeArcadiaCodexCliScript(argvPath: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args));

process.stdout.write(JSON.stringify({
  ok: true,
  command: "codex.list",
  workspace: args[args.indexOf("--workspace") + 1],
  data: {
    observedCount: 1,
    missionLogPaths: [],
    tasks: [{
      id: "ctask_1",
      source: "local_goal",
      source_task_id: "thread_1",
      title: "Implement Codex Companion",
      status: "active",
      url: null,
      summary: "Implement Arcadia Codex Companion.",
      project_id: "proj_1",
      milestone_id: "ms_1",
      mission_log_id: null,
      project_name: "Rebuster",
      milestone_title: "Codex Companion",
      mission_log_path: null,
      last_observed_at: "2026-06-10T12:00:00.000Z"
    }]
  },
  artifacts: [],
  warnings: []
}));
`;
}
