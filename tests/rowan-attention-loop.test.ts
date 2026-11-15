import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { acknowledgeMailMessage, listMailInbox, sendMailMessage, type SendMailMessageInput } from "../src/nativeMail/store.js";
import { attentionEpisodeKey, attentionTiming, listOverdueAttention, relayAttention } from "../src/nativeMail/attention.js";
import { markOperatorPingSent } from "../src/ping/operatorPing.js";

/**
 * Synthetic worker → Rowan → operator attention round trip (Action
 * prove-rowan-supervisor-attention-loop). Workers, Rowan and the operator
 * surface are fictional; the Discord adapter's presentation is simulated by
 * `markOperatorPingSent`. Every row lives in a disposable workspace.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-rowan-attention-"));
  roots.push(root);
  initWorkspace(root);
  return root;
}

const PLAN = "prove-the-rowan-supervisor-attention-loop";
const ROWAN = { recipientSessionIncarnation: "rowan-1", recipientGeneration: "gen-1" };
const SCOPE = { projectSlug: "fixture-ppn", planSlug: PLAN, ...ROWAN };

function workerMail(worker: string, requestId: string, body: Record<string, unknown>, overrides: Partial<SendMailMessageInput> = {}): SendMailMessageInput {
  return {
    requestId,
    kind: "request",
    sender: { repository: "/repo/fixture-ppn", projectSlug: "fixture-ppn", planSlug: PLAN, sessionIncarnation: worker, generation: "gen-1" },
    recipient: { sessionIncarnation: "rowan-1", generation: "gen-1" },
    assignmentEvidence: `fixture-ppn/${worker}-action`,
    receiverCheckpointCapability: "attention-roundtrip",
    body,
    actor: worker,
    ...overrides
  };
}

const RESULT = { significance: "result", summary: "Mobile Lighthouse 97/97/97 reached", evidence: "fixture lighthouse report" };
const BLOCKER = {
  significance: "blocker",
  summary: "Deploy preview needs the operator",
  readyAction: "Choose A to approve the preview deploy",
  consequence: "Without it the release Action stays held",
  evidence: "fixture CI run 42"
};

describe("Rowan attention loop: two workers, one operator request", () => {
  it("acknowledges both, relays exactly one actionable request, and records timing under the 60s target", () => {
    const ws = workspace();
    const result = withDatabase(ws, (db) => {
      const resultMail = sendMailMessage(db, workerMail("worker-nagel", "w1-result", RESULT)).message;
      const blockerMail = sendMailMessage(db, workerMail("worker-ellis", "w2-blocker", BLOCKER)).message;
      const progressMail = sendMailMessage(db, workerMail("worker-ellis", "w2-progress", { significance: "progress", summary: "tests 40% done" })).message;

      const inbox = listMailInbox(db, { projectSlug: "fixture-ppn", planSlug: PLAN, ...ROWAN, actor: "rowan" });
      expect(inbox.map((m) => m.id)).toEqual([resultMail.id, blockerMail.id, progressMail.id]);
      for (const mail of inbox) acknowledgeMailMessage(db, { ...SCOPE, messageId: mail.id, actor: "rowan" });

      const relays = inbox.map((mail) => relayAttention(db, { ...SCOPE, messageId: mail.id, actor: "rowan" }));
      return { relays, blockerId: blockerMail.id, pings: db.prepare("SELECT * FROM operator_pings").all() as Array<{ id: string; message: string; kind: string }> };
    });

    expect(result.relays.map((r) => r.outcome)).toEqual(["digest", "relayed", "digest"]);
    expect(result.pings).toHaveLength(1);
    expect(result.pings[0].kind).toBe("attention");
    expect(result.pings[0].message).toContain("Choose A to approve the preview deploy");
    expect(result.pings[0].message).toContain(attentionEpisodeKey(result.blockerId));
    expect(result.pings[0].message).not.toContain("40% done");

    const timing = withDatabase(ws, (db) => {
      markOperatorPingSent(db, result.pings[0].id, "discord-fixture-1");
      return attentionTiming(db, result.blockerId);
    });
    expect(timing.presentedAt).not.toBeNull();
    expect(timing.emittedToAcknowledgedMs).toBeGreaterThanOrEqual(0);
    expect(timing.emittedToPresentedMs!).toBeGreaterThanOrEqual(timing.emittedToQueuedMs!);
    expect(timing.emittedToPresentedMs!).toBeLessThan(60_000);
  });

  it("a replayed relay, a retry by a second actor and a re-sent worker request never page twice", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const mail = sendMailMessage(db, workerMail("worker-ellis", "w2-blocker", BLOCKER)).message;
      acknowledgeMailMessage(db, { ...SCOPE, messageId: mail.id, actor: "rowan" });
      const first = relayAttention(db, { ...SCOPE, messageId: mail.id, actor: "rowan" });
      const replay = relayAttention(db, { ...SCOPE, messageId: mail.id, actor: "rowan" });
      const otherActor = relayAttention(db, { ...SCOPE, messageId: mail.id, actor: "rowan-retry" });
      const resent = sendMailMessage(db, workerMail("worker-ellis", "w2-blocker", BLOCKER));
      expect(resent.message.id).toBe(mail.id);
      expect(first.outcome).toBe("relayed");
      expect(replay.outcome).toBe("duplicate");
      expect(otherActor.outcome).toBe("duplicate");
      expect(replay.ping!.id).toBe(first.ping!.id);
      expect((db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n).toBe(1);
    });
  });

  it("worker text naming another mail's episode key cannot suppress that mail's page", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const target = sendMailMessage(db, workerMail("worker-a", "target", BLOCKER)).message;
      const spoof = sendMailMessage(db, workerMail("worker-b", "spoof", { ...BLOCKER, evidence: `see ${attentionEpisodeKey(target.id)}` })).message;
      for (const id of [spoof.id, target.id]) acknowledgeMailMessage(db, { ...SCOPE, messageId: id, actor: "rowan" });
      expect(relayAttention(db, { ...SCOPE, messageId: spoof.id, actor: "rowan" }).outcome).toBe("relayed");
      expect(relayAttention(db, { ...SCOPE, messageId: target.id, actor: "rowan" }).outcome).toBe("relayed");
      expect((db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n).toBe(2);
    });
  });

  it("refuses an unacknowledged, stale or incomplete blocker", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const unacked = sendMailMessage(db, workerMail("worker-a", "unacked", BLOCKER)).message;
      expect(() => relayAttention(db, { ...SCOPE, messageId: unacked.id, actor: "rowan" })).toThrow(/Acknowledge the mail/);

      const thin = sendMailMessage(db, workerMail("worker-b", "thin", { significance: "blocker", summary: "stuck" })).message;
      acknowledgeMailMessage(db, { ...SCOPE, messageId: thin.id, actor: "rowan" });
      expect(() => relayAttention(db, { ...SCOPE, messageId: thin.id, actor: "rowan" })).toThrow(/readyAction, consequence and evidence/);

      const soon = new Date(Date.now() + 5_000).toISOString();
      const stale = sendMailMessage(db, workerMail("worker-c", "stale", BLOCKER, { expiresAt: soon })).message;
      acknowledgeMailMessage(db, { ...SCOPE, messageId: stale.id, actor: "rowan" });
      expect(() => relayAttention(db, { ...SCOPE, messageId: stale.id, actor: "rowan", now: new Date(Date.now() + 10_000) })).toThrow(/stale request is never relayed/);
      expect((db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n).toBe(0);
    });
  });
});

describe("Rowan attention loop: overdue visibility and custody continuity", () => {
  it("shows undispatched and unacknowledged mail as overdue, then stale once expired", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const neverRead = sendMailMessage(db, workerMail("worker-a", "never-read", BLOCKER)).message;
      const created = Date.parse(neverRead.createdAt);
      expect(listOverdueAttention(db, { now: new Date(created + 30_000) })).toEqual([]);

      const later = new Date(created + 61_000);
      expect(listOverdueAttention(db, { now: later }).map((o) => [o.messageId, o.state])).toEqual([[neverRead.id, "undispatched"]]);

      listMailInbox(db, { projectSlug: "fixture-ppn", planSlug: PLAN, ...ROWAN, actor: "rowan" });
      expect(listOverdueAttention(db, { now: later })[0].state).toBe("unacknowledged");

      acknowledgeMailMessage(db, { ...SCOPE, messageId: neverRead.id, actor: "rowan" });
      expect(listOverdueAttention(db, { now: later })).toEqual([]);

      const expiring = sendMailMessage(db, workerMail("worker-b", "expiring", BLOCKER, { expiresAt: new Date(Date.now() + 1_000).toISOString() })).message;
      const stale = listOverdueAttention(db, { now: new Date(Date.parse(expiring.createdAt) + 120_000) });
      expect(stale.map((o) => [o.messageId, o.state])).toEqual([[expiring.id, "stale"]]);
    });
  });

  it("a successor generation cannot silently acknowledge or relay the predecessor's mail, and the pending request stays visible", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const pending = sendMailMessage(db, workerMail("worker-ellis", "w2-blocker", BLOCKER)).message;
      listMailInbox(db, { projectSlug: "fixture-ppn", planSlug: PLAN, ...ROWAN, actor: "rowan" });
      const successor = { projectSlug: "fixture-ppn", planSlug: PLAN, recipientSessionIncarnation: "rowan-1", recipientGeneration: "gen-2" };
      expect(() => acknowledgeMailMessage(db, { ...successor, messageId: pending.id, actor: "rowan-2" })).toThrow(/stale recipient generation/);
      expect(() => relayAttention(db, { ...successor, messageId: pending.id, actor: "rowan-2" })).toThrow(/stale recipient generation/);
      const standby = { ...successor, recipientSessionIncarnation: "rowan-standby", recipientGeneration: "gen-1" };
      expect(() => relayAttention(db, { ...standby, messageId: pending.id, actor: "rowan-standby" })).toThrow(/wrong recipient/);

      const overdue = listOverdueAttention(db, { now: new Date(Date.parse(pending.createdAt) + 61_000) });
      expect(overdue).toHaveLength(1);
      expect(overdue[0]).toMatchObject({ messageId: pending.id, recipient: "rowan-1", recipientGeneration: "gen-1", significance: "blocker", state: "unacknowledged" });
      expect((db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n).toBe(0);
    });
  });

  it("isolates projects: one project's overdue blocker does not hide or delay another project's relay", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const stuck = sendMailMessage(db, workerMail("worker-a", "stuck", BLOCKER)).message;
      const other = sendMailMessage(db, workerMail("worker-z", "other", BLOCKER, {
        sender: { repository: "/repo/fixture-rebuster", projectSlug: "fixture-rebuster", planSlug: PLAN, sessionIncarnation: "worker-z", generation: "gen-1" },
        recipient: { sessionIncarnation: "rowan-rb", generation: "gen-1" }
      })).message;
      const rbScope = { projectSlug: "fixture-rebuster", planSlug: PLAN, recipientSessionIncarnation: "rowan-rb", recipientGeneration: "gen-1" };
      acknowledgeMailMessage(db, { ...rbScope, messageId: other.id, actor: "rowan-rb" });
      expect(relayAttention(db, { ...rbScope, messageId: other.id, actor: "rowan-rb" }).outcome).toBe("relayed");

      const later = new Date(Date.parse(stuck.createdAt) + 61_000);
      expect(listOverdueAttention(db, { now: later, projectSlug: "fixture-ppn" }).map((o) => o.messageId)).toEqual([stuck.id]);
      expect(listOverdueAttention(db, { now: later, projectSlug: "fixture-rebuster" })).toEqual([]);
    });
  });
});
