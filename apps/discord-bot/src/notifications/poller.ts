import type { Client } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { CodexTask, ExecutionRun, Milestone } from "../arcadia/types.js";
import type { BotConfig } from "../config.js";
import { formatCodexTaskNotification } from "../formatters/codexFormatter.js";
import { formatMilestoneCompletedNotification } from "../formatters/milestoneFormatter.js";
import type { LogLevel } from "../logging.js";
import { requiresReviewTransitionMessage } from "./requiresReview.js";
import { runCompletedMessage, runRequiresReviewMessage } from "./runCompleted.js";
import { runFailedMessage } from "./runFailed.js";
import {
  discordSubmissionStatePath,
  loadDiscordSubmissionState,
  loadNotificationState,
  notificationStatePath,
  saveNotificationState,
  type DiscordSubmissionState,
  type NotificationState
} from "./state.js";

export interface NotificationSnapshot {
  requiresReviewCount: number;
  runs: ExecutionRun[];
  completedMilestones: Milestone[];
  codexTasks: CodexTask[];
}

export interface NotificationMessage {
  key: string;
  content: string;
}

export interface NotificationEvaluation {
  messages: NotificationMessage[];
  nextState: NotificationState;
}

export async function loadNotificationSnapshot(cli: ArcadiaCli): Promise<NotificationSnapshot> {
  const [status, runs, milestones, codex] = await Promise.all([
    cli.status(),
    cli.runs(20),
    cli.milestones("completed", 20),
    cli.codexTasks(false)
  ]);

  return {
    requiresReviewCount: status.data.requiresReviewCount,
    runs: runs.data.runs,
    completedMilestones: milestones.data.milestones,
    codexTasks: codex.data.tasks
  };
}

export function evaluateNotifications(
  snapshot: NotificationSnapshot,
  previous: NotificationState | null,
  now = new Date().toISOString(),
  submissions: DiscordSubmissionState = emptyDiscordSubmissionState(now)
): NotificationEvaluation {
  const notableRunIds = snapshot.runs
    .filter((run) => run.status === "failed" || run.status === "needs_mark")
    .map((run) => run.id);
  const completedDiscordRunIds = snapshot.runs
    .filter((run) => run.status === "completed" && isDiscordSubmittedRun(run, submissions))
    .map((run) => run.id);
  const completedMilestoneIds = snapshot.completedMilestones.map((milestone) => milestone.id);
  const codexTaskStatuses = Object.fromEntries(snapshot.codexTasks.map((task) => [task.id, task.status]));
  const codexTerminalOrReviewEvents = snapshot.codexTasks
    .map((task) => codexEventForStatus(null, task.status) ? `${task.id}:${codexEventForStatus(null, task.status)}` : null)
    .filter((event): event is string => Boolean(event));

  if (!previous) {
    return {
      messages: [],
      nextState: {
        initializedAt: now,
        lastRequiresReviewCount: snapshot.requiresReviewCount,
        notifiedRunIds: Array.from(new Set([...notableRunIds, ...completedDiscordRunIds])),
        notifiedMilestoneIds: completedMilestoneIds,
        codexTaskStatuses,
        notifiedCodexTaskEvents: codexTerminalOrReviewEvents
      }
    };
  }

  const sentRuns = new Set(previous.notifiedRunIds);
  const sentMilestones = new Set(previous.notifiedMilestoneIds);
  const sentCodexEvents = new Set(previous.notifiedCodexTaskEvents);
  const messages: NotificationMessage[] = [];

  for (const run of snapshot.runs) {
    if (sentRuns.has(run.id)) {
      continue;
    }

    if (run.status === "failed") {
      messages.push({ key: `run:${run.id}`, content: runFailedMessage(run) });
    } else if (run.status === "needs_mark") {
      messages.push({ key: `run:${run.id}`, content: runRequiresReviewMessage(run) });
    } else if (run.status === "completed" && isDiscordSubmittedRun(run, submissions)) {
      messages.push({ key: `run:${run.id}`, content: runCompletedMessage(run) });
    }
  }

  if (previous.lastRequiresReviewCount === 0 && snapshot.requiresReviewCount > 0) {
    messages.push({
      key: "requires-review:transition",
      content: requiresReviewTransitionMessage(snapshot.requiresReviewCount)
    });
  }

  for (const milestone of snapshot.completedMilestones) {
    if (!sentMilestones.has(milestone.id)) {
      messages.push({
        key: `milestone:${milestone.id}`,
        content: formatMilestoneCompletedNotification(milestone)
      });
    }
  }

  const nextCodexEvents = new Set(previous.notifiedCodexTaskEvents);
  for (const task of snapshot.codexTasks) {
    const previousStatus = previous.codexTaskStatuses[task.id] ?? null;
    const event = codexEventForStatus(previousStatus, task.status);
    if (!event) {
      continue;
    }
    const eventKey = `${task.id}:${event}`;
    nextCodexEvents.add(eventKey);
    if (!sentCodexEvents.has(eventKey)) {
      messages.push({
        key: `codex:${eventKey}`,
        content: formatCodexTaskNotification(task, event)
      });
    }
  }

  return {
    messages,
    nextState: {
      initializedAt: previous.initializedAt,
      lastRequiresReviewCount: snapshot.requiresReviewCount,
      notifiedRunIds: Array.from(new Set([...previous.notifiedRunIds, ...notableRunIds, ...completedDiscordRunIds])),
      notifiedMilestoneIds: Array.from(new Set([...previous.notifiedMilestoneIds, ...completedMilestoneIds])),
      codexTaskStatuses,
      notifiedCodexTaskEvents: Array.from(nextCodexEvents)
    }
  };
}

export function startNotificationPoller(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const statePath = notificationStatePath(config.arcadiaWorkspace);
      const submissionPath = discordSubmissionStatePath(config.arcadiaWorkspace);
      const [previous, snapshot, submissions] = await Promise.all([
        loadNotificationState(statePath),
        loadNotificationSnapshot(cli),
        loadDiscordSubmissionState(submissionPath)
      ]);
      const evaluation = evaluateNotifications(snapshot, previous, new Date().toISOString(), submissions);

      for (const message of evaluation.messages) {
        await sendToConfiguredChannel(client, config.discordChannelId, message.content);
        logJson("info", { msg: "discord notification sent", key: message.key });
      }

      await saveNotificationState(statePath, evaluation.nextState);
    } catch (error) {
      logJson("error", {
        msg: "discord notification poll failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  void tick();
  return setInterval(() => void tick(), config.pollIntervalSeconds * 1000);
}

async function sendToConfiguredChannel(client: Client, channelId: string, content: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("send" in channel)) {
    throw new Error("Configured Discord channel is not sendable.");
  }

  await channel.send({ content });
}

function isDiscordSubmittedRun(run: ExecutionRun, submissions: DiscordSubmissionState): boolean {
  return (
    submissions.submittedRunIds.includes(run.id) ||
    (typeof run.work_item_id === "string" && submissions.submittedWorkItemIds.includes(run.work_item_id))
  );
}

function emptyDiscordSubmissionState(now: string): DiscordSubmissionState {
  return {
    submittedAskIds: [],
    submittedWorkItemIds: [],
    submittedRunIds: [],
    updatedAt: now
  };
}

function codexEventForStatus(
  previousStatus: string | null,
  status: string
): "started" | "requires_review" | "completed" | "failed" | null {
  const normalized = status.toLowerCase();
  const previous = previousStatus?.toLowerCase() ?? null;
  if (previous === null && ["active", "running", "in_progress", "pending"].includes(normalized)) {
    return "started";
  }
  if (previous !== normalized && ["blocked", "needs_review", "requires_review", "usage_limited", "budget_limited"].includes(normalized)) {
    return "requires_review";
  }
  if (previous !== normalized && ["complete", "completed", "succeeded", "success"].includes(normalized)) {
    return "completed";
  }
  if (previous !== normalized && ["failed", "error"].includes(normalized)) {
    return "failed";
  }
  return null;
}
