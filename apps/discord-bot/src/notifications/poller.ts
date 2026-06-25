import type { Client } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { CodexTask, ExecutionRun, Milestone, ReviewItem, WorkItem } from "../arcadia/types.js";
import type { BotConfig } from "../config.js";
import { formatCodexTaskNotification } from "../formatters/codexFormatter.js";
import { formatMilestoneCompletedNotification } from "../formatters/milestoneFormatter.js";
import type { LogLevel } from "../logging.js";
import { formatRequiresReviewNotificationItem } from "../formatters/requiresReviewFormatter.js";
import { requiresReviewTransitionMessage } from "./requiresReview.js";
import { runCompletedMessage, runRequiresReviewMessage } from "./runCompleted.js";
import { runFailedMessage } from "./runFailed.js";
import {
  discordSubmissionStatePath,
  loadDiscordSubmissionState,
  loadNotificationState,
  notificationStatePath,
  recordReviewMessage,
  reviewMessageStatePath,
  saveNotificationState,
  type DiscordSubmissionState,
  type NotificationState
} from "./state.js";

export interface NotificationSnapshot {
  requiresReviewCount: number;
  reviewItems: ReviewItem[];
  blockedWorkItems: WorkItem[];
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
  const [status, review, queue, runs, milestones, codex] = await Promise.all([
    cli.status(),
    cli.review(),
    cli.queue(),
    cli.runs(20),
    cli.milestones("completed", 20),
    cli.codexTasks(false)
  ]);

  return {
    requiresReviewCount: status.data.requiresReviewCount,
    reviewItems: review.data.items,
    blockedWorkItems: queue.data.queues.blocked,
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
  const reviewItems = snapshot.reviewItems ?? [];
  const blockedWorkItems = snapshot.blockedWorkItems ?? [];
  const notableRunIds = snapshot.runs
    .filter((run) => run.status === "failed" || isRequiresReviewStatus(run.status))
    .map((run) => run.id);
  const completedDiscordRunIds = snapshot.runs
    .filter((run) => run.status === "completed" && isDiscordSubmittedRun(run, submissions))
    .map((run) => run.id);
  const completedMilestoneIds = snapshot.completedMilestones.map((milestone) => milestone.id);
  const reviewItemIds = reviewItems.map((item) => item.id);
  const blockedWorkItemIds = blockedWorkItems.map((item) => item.id);
  const artifactIds = snapshot.runs.flatMap((run) =>
    run.status === "completed" ? run.artifacts.map((artifact) => artifact.id) : []
  );
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
        notifiedReviewItemIds: reviewItemIds,
        notifiedRunIds: Array.from(new Set([...notableRunIds, ...completedDiscordRunIds])),
        notifiedMilestoneIds: completedMilestoneIds,
        notifiedBlockedWorkItemIds: blockedWorkItemIds,
        notifiedArtifactIds: artifactIds,
        codexTaskStatuses,
        notifiedCodexTaskEvents: codexTerminalOrReviewEvents
      }
    };
  }

  const previousReviewItemIds = previous.notifiedReviewItemIds ?? [];
  const previousRunIds = previous.notifiedRunIds ?? [];
  const previousMilestoneIds = previous.notifiedMilestoneIds ?? [];
  const previousBlockedWorkItemIds = previous.notifiedBlockedWorkItemIds ?? [];
  const previousArtifactIds = previous.notifiedArtifactIds ?? [];
  const sentRuns = new Set(previousRunIds);
  const sentMilestones = new Set(previousMilestoneIds);
  const sentReviewItems = new Set(previousReviewItemIds);
  const sentBlockedWorkItems = new Set(previousBlockedWorkItemIds);
  const sentArtifacts = new Set(previousArtifactIds);
  const sentCodexEvents = new Set(previous.notifiedCodexTaskEvents);
  const messages: NotificationMessage[] = [];

  for (const item of reviewItems) {
    if (!sentReviewItems.has(item.id)) {
      messages.push({
        key: `requires-review:${item.id}`,
        content: requiresReviewItemMessage(item)
      });
    }
  }

  for (const run of snapshot.runs) {
    if (sentRuns.has(run.id)) {
      continue;
    }

    if (run.status === "failed") {
      messages.push({ key: `run:${run.id}`, content: runFailedMessage(run) });
    } else if (isRequiresReviewStatus(run.status)) {
      messages.push({ key: `run:${run.id}`, content: runRequiresReviewMessage(run) });
    } else if (run.status === "completed" && isDiscordSubmittedRun(run, submissions)) {
      messages.push({ key: `run:${run.id}`, content: runCompletedMessage(run) });
    }
  }

  if (
    reviewItems.length === 0 &&
    previous.lastRequiresReviewCount === 0 &&
    snapshot.requiresReviewCount > 0
  ) {
    messages.push({
      key: "requires-review:transition",
      content: requiresReviewTransitionMessage(snapshot.requiresReviewCount)
    });
  }

  for (const workItem of blockedWorkItems) {
    if (!sentBlockedWorkItems.has(workItem.id)) {
      messages.push({
        key: `blocked:${workItem.id}`,
        content: blockedWorkItemMessage(workItem)
      });
    }
  }

  for (const run of snapshot.runs) {
    if (run.status !== "completed") {
      continue;
    }
    for (const artifact of run.artifacts) {
      if (!sentArtifacts.has(artifact.id)) {
        messages.push({
          key: `artifact:${artifact.id}`,
          content: artifactProducedMessage(run, artifact)
        });
      }
    }
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
      notifiedReviewItemIds: Array.from(new Set([...previousReviewItemIds, ...reviewItemIds])),
      notifiedRunIds: Array.from(new Set([...previousRunIds, ...notableRunIds, ...completedDiscordRunIds])),
      notifiedMilestoneIds: Array.from(new Set([...previousMilestoneIds, ...completedMilestoneIds])),
      notifiedBlockedWorkItemIds: Array.from(new Set([...previousBlockedWorkItemIds, ...blockedWorkItemIds])),
      notifiedArtifactIds: Array.from(new Set([...previousArtifactIds, ...artifactIds])),
      codexTaskStatuses,
      notifiedCodexTaskEvents: Array.from(nextCodexEvents)
    }
  };
}

function isRequiresReviewStatus(value: string | null | undefined): boolean {
  return value === "requires_review" || value === "needs_mark";
}

function requiresReviewItemMessage(item: ReviewItem): string {
  return formatRequiresReviewNotificationItem(item);
}

function blockedWorkItemMessage(item: WorkItem): string {
  return [
    `Blocked: ${item.project_name ?? "Unassigned"} - ${item.title}`,
    `Next action: ${item.next_action}`,
    `Action: ${item.id}`
  ].join("\n");
}

function artifactProducedMessage(
  run: ExecutionRun,
  artifact: ExecutionRun["artifacts"][number]
): string {
  return [
    `Artifact produced: ${artifact.title}`,
    `Run: ${run.id}`,
    artifact.path ? `Path: ${artifact.path}` : null
  ].filter((line): line is string => Boolean(line)).join("\n");
}

const ACTIVE_POLL_INTERVAL_MS = 5_000;

export function startNotificationPoller(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    let hasActiveRuns = false;
    try {
      const statePath = notificationStatePath(config.arcadiaWorkspace);
      const submissionPath = discordSubmissionStatePath(config.arcadiaWorkspace);
      const [previous, snapshot, submissions] = await Promise.all([
        loadNotificationState(statePath),
        loadNotificationSnapshot(cli),
        loadDiscordSubmissionState(submissionPath)
      ]);

      hasActiveRuns = snapshot.runs.some(
        (run) => run.status === "running" || run.status === "pending_execution"
      );

      const evaluation = evaluateNotifications(snapshot, previous, new Date().toISOString(), submissions);

      for (const message of evaluation.messages) {
        const sent = await sendToConfiguredChannel(client, config.discordChannelId, message.content);
        const reviewId = reviewIdFromNotificationKey(message.key);
        if (reviewId) {
          const item = snapshot.reviewItems.find((candidate) => candidate.id === reviewId);
          if (item) {
            await recordReviewMessage(reviewMessageStatePath(config.arcadiaWorkspace), {
              reviewId: item.id,
              reviewSlug: item.slug,
              channelId: config.discordChannelId,
              messageId: sent.id,
              createdAt: new Date().toISOString()
            });
          }
        }
        logJson("info", { msg: "discord notification sent", key: message.key });
      }

      await saveNotificationState(statePath, evaluation.nextState);
    } catch (error) {
      logJson("error", {
        msg: "discord notification poll failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const nextInterval = hasActiveRuns ? ACTIVE_POLL_INTERVAL_MS : config.pollIntervalSeconds * 1000;
    timer = setTimeout(() => void tick(), nextInterval);
  };

  timer = setTimeout(() => void tick(), 0);
  void timer;
}

async function sendToConfiguredChannel(client: Client, channelId: string, content: string): Promise<{ id: string }> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("send" in channel)) {
    throw new Error("Configured Discord channel is not sendable.");
  }

  return channel.send({ content });
}

function reviewIdFromNotificationKey(key: string): string | null {
  return key.startsWith("requires-review:") && key !== "requires-review:transition"
    ? key.slice("requires-review:".length)
    : null;
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
