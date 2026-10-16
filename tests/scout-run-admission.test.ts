import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { admissionDigest, consumeScoutReservation, finishScoutAttempt, reserveScoutAttempt, SCOUT_GOAL, type AdmissionScope } from "../src/scout/runAdmission.js";
import { admissionFixture } from "./fixtures/scout-admission.js";
import { repoRoot, tsxLoader } from "./cli-response-fixture.js";

const roots: string[] = [];
const now = Date.parse("2026-10-16T09:00:00Z");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "scout-admission-scope-"))); roots.push(root);
  const workspace = path.join(root, "fixture", "workspace"); const repo = path.join(workspace, "repo"); mkdirSync(repo, { recursive: true });
  const scope: AdmissionScope = { runId: "fixture-run-1", askId: "fixture-ask-1", workspace, repo, sourceHead: "a".repeat(40) };
  const f = admissionFixture(scope, now); roots.push(f.root);
  return { ...f, scope, root, reserve: (at = now) => reserveScoutAttempt(f.stores, f.evidence, scope, "scripted-fixture", at) };
}
function refresh(f: ReturnType<typeof fixture>, at: number, revision: string) {
  f.scope.sourceHead = revision;
  f.evidence.scope = { ...f.scope }; f.evidence.assignment.scope = { ...f.scope };
  f.evidence.codeReview.sourceHead = revision; f.evidence.qa.sourceHead = revision;
  f.evidence.isolation.pins.sourceRevision = revision;
  f.evidence.isolation.before!.takenAt = new Date(at).toISOString(); f.evidence.isolation.after!.takenAt = new Date(at).toISOString();
  f.evidence.capacity.observedAt = new Date(at).toISOString();
}

describe("durable Decision 0128 admission", () => {
  it("retains stable goal, first launch and cumulative attempts/repairs across restart, source and fixture recreation", () => {
    const f = fixture(); const first = f.reserve();
    expect(f.read().attempts[0].id).toBe(first.id);
    finishScoutAttempt(f.stores, f.evidence.isolation.pins.fixtureRoot, first, { failure: "wrong bytes", retryable: true }, now + 1000);
    const next = now + 90_000;
    // Delete and recreate the disposable fixture. Stores are outside it.
    rmSync(f.scope.workspace, { recursive: true }); mkdirSync(f.scope.repo, { recursive: true });
    refresh(f, next, "b".repeat(40)); f.scope.runId = "fixture-run-2"; f.evidence.scope.runId = f.scope.runId; f.evidence.assignment.scope.runId = f.scope.runId;
    f.evidence.retry = { failure: "wrong bytes", previousReservation: first.id, verifiedFix: "verified byte fix" }; f.pin();
    const input = path.join(f.root, "restart.json"); writeFileSync(input, JSON.stringify({ stores: f.stores, evidence: f.evidence, scope: f.scope, now: next }));
    const script = path.join(f.root, "restart.mts"); writeFileSync(script, `import { readFileSync } from 'node:fs'; import { reserveScoutAttempt } from ${JSON.stringify(path.join(repoRoot, "src/scout/runAdmission.ts"))}; const v=JSON.parse(readFileSync(process.argv[2],'utf8')); console.log(JSON.stringify(reserveScoutAttempt(v.stores,v.evidence,v.scope,'scripted-fixture',v.now)));`);
    const second = JSON.parse(execFileSync(process.execPath, ["--import", tsxLoader, script, input], { encoding: "utf8" }));
    expect(second).toMatchObject({ attempt: 2, repairs: 1, firstLaunch: now });
    expect(f.read()).toMatchObject({ goal: SCOUT_GOAL, firstLaunch: now, repairs: 1 });
    expect(f.read().attempts).toHaveLength(2);
  });

  it("bounds three attempts and two repairs; elapsed waits never reset", () => {
    const f = fixture(); let prior = f.reserve();
    for (let index = 1; index <= 2; index++) {
      finishScoutAttempt(f.stores, f.evidence.isolation.pins.fixtureRoot, prior, { failure: `failure-${index}`, retryable: true }, now + (index - 1) * 90_000 + 1000);
      refresh(f, now + index * 90_000, String(index + 1).repeat(40));
      f.evidence.retry = { failure: `failure-${index}`, previousReservation: prior.id, verifiedFix: `verified fix ${index}` }; f.pin();
      prior = f.reserve(now + index * 90_000);
      expect(prior.deadline - (now + index * 90_000)).toBe(90_000);
    }
    refresh(f, now + 270_000, "d".repeat(40)); f.pin();
    expect(() => f.reserve(now + 270_000)).toThrow(/exhausted/);
    expect(f.read().attempts).toHaveLength(3); expect(f.read().repairs).toBe(2);
    const elapsed = fixture(); elapsed.reserve(); refresh(elapsed, now + 90 * 60_000, "b".repeat(40)); elapsed.pin();
    expect(() => elapsed.reserve(now + 90 * 60_000)).toThrow(/elapsed allowance exhausted/);
  });

  it("restoring an earlier internally valid ledger fails against a separately retained newer witness", () => {
    const f = fixture(); const snapshot = path.join(f.root, "old.sqlite"); copyFileSync(f.stores.ledger, snapshot);
    const old = f.read(); const first = f.reserve();
    expect(f.read().attempts[0].id).toBe(first.id);
    copyFileSync(snapshot, f.stores.ledger);
    expect(f.read()).toEqual(old); // Still internally valid; not just damaged JSON.
    expect(() => f.reserve()).toThrow(/restored history/);
    expect(f.read().attempts).toHaveLength(0);
  });

  it("serializes concurrent independent processes before any scripted provider invocation", async () => {
    const f = fixture(); const input = path.join(f.root, "input.json"); writeFileSync(input, JSON.stringify({ stores: f.stores, evidence: f.evidence, scope: f.scope, now }));
    const marker = path.join(f.root, "provider-calls"); const script = path.join(f.root, "concurrent.mts");
    writeFileSync(script, `import {readFileSync,appendFileSync} from 'node:fs'; import {reserveScoutAttempt} from ${JSON.stringify(path.join(repoRoot, "src/scout/runAdmission.ts"))}; const v=JSON.parse(readFileSync(process.argv[2],'utf8')); reserveScoutAttempt(v.stores,v.evidence,v.scope,'scripted-fixture',v.now); appendFileSync(${JSON.stringify(marker)},'scripted\\n');`);
    const run = () => new Promise<number | null>((resolve) => { const child = spawn(process.execPath, ["--import", tsxLoader, script, input], { stdio: "ignore" }); child.on("exit", resolve); });
    const exits = await Promise.all([run(), run(), run(), run()]);
    expect(exits.filter((exit) => exit === 0)).toHaveLength(1);
    expect(readFileSync(marker, "utf8")).toBe("scripted\n"); expect(f.read().attempts).toHaveLength(1);
  });

  it("crash after committed reservation consumes allowance, while a crash between stores fails closed", () => {
    const f = fixture(); const script = path.join(f.root, "crash.mts"); const input = path.join(f.root, "crash.json");
    writeFileSync(input, JSON.stringify({ stores: f.stores, evidence: f.evidence, scope: f.scope, now }));
    writeFileSync(script, `import {readFileSync} from 'node:fs'; import {reserveScoutAttempt} from ${JSON.stringify(path.join(repoRoot, "src/scout/runAdmission.ts"))}; const v=JSON.parse(readFileSync(process.argv[2],'utf8')); reserveScoutAttempt(v.stores,v.evidence,v.scope,'scripted-fixture',v.now); process.kill(process.pid,'SIGKILL');`);
    expect(() => execFileSync(process.execPath, ["--import", tsxLoader, script, input], { stdio: "ignore" })).toThrow();
    expect(f.read().attempts).toHaveLength(1);
    refresh(f, now + 90_000, "b".repeat(40)); f.evidence.retry = { failure: "ambiguous parent interruption", previousReservation: f.read().attempts[0].id, verifiedFix: "candidate fix" }; f.pin();
    expect(() => f.reserve(now + 90_000)).toThrow(/retry requires/);
    const split = fixture(); const splitInput = path.join(split.root, "split.json");
    writeFileSync(splitInput, JSON.stringify({ stores: split.stores, evidence: split.evidence, scope: split.scope, now }));
    const splitScript = path.join(split.root, "split.mts");
    writeFileSync(splitScript, `import Database from ${JSON.stringify(path.join(repoRoot, "node_modules/better-sqlite3/lib/index.js"))}; import {readFileSync} from 'node:fs';
      import {reserveScoutAttempt} from ${JSON.stringify(path.join(repoRoot, "src/scout/runAdmission.ts"))}; const v=JSON.parse(readFileSync(process.argv[2],'utf8'));
      const original=Database.prototype.transaction; Database.prototype.transaction=function(fn){const name=this.name;return original.call(this,(...args)=>{const result=fn(...args);if(name===v.stores.witness)process.kill(process.pid,'SIGKILL');return result;});};
      reserveScoutAttempt(v.stores,v.evidence,v.scope,'scripted-fixture',v.now);`);
    expect(() => execFileSync(process.execPath, ["--import", tsxLoader, splitScript, splitInput], { stdio: "ignore" })).toThrow();
    expect(split.read().attempts).toHaveLength(1); // ledger committed; witness did not
    expect(() => split.reserve()).toThrow(/restored history/);
  });

  it.each(["expiry", "rollback", "missing", "corrupt", "authority", "isolation", "review", "qa", "capacity", "paid", "fallback", "witness-pin", "fixture-store"])("refuses %s before invocation", (failure) => {
    const f = fixture(); let at = now;
    if (failure === "expiry") at = Date.parse("2026-10-18T00:00:00Z");
    if (failure === "rollback") { f.reserve(); at--; }
    if (failure === "missing") rmSync(f.stores.ledger);
    if (failure === "corrupt") { const db = new Database(f.stores.ledger); db.prepare("UPDATE scout_admission SET body = 'garbage'").run(); db.close(); }
    if (failure === "authority") f.evidence.assignment.approved = false as true;
    if (failure === "isolation") f.evidence.isolation.after = null;
    if (failure === "review") f.evidence.codeReview.sourceHead = "0".repeat(40);
    if (failure === "qa") f.evidence.qa.session = f.evidence.codeReview.session;
    if (failure === "capacity") f.evidence.capacity.observedAt = null;
    if (failure === "paid") f.evidence.capacity.usagePolicy = "paid";
    if (failure === "fallback") f.evidence.billing.fallback = true as false;
    if (failure === "witness-pin") f.evidence.assignment.implementer = "unapproved replacement";
    if (failure === "fixture-store") { const file = path.join(f.scope.workspace, "ledger.sqlite"); copyFileSync(f.stores.ledger, file); f.stores.ledger = file; }
    expect(() => f.reserve(at)).toThrow();
  });

  it("requires a changed source, verified fix and matching named failure for every retry", () => {
    const f = fixture(); const first = f.reserve(); finishScoutAttempt(f.stores, f.evidence.isolation.pins.fixtureRoot, first, { failure: "wrong bytes", retryable: true }, now + 1);
    f.evidence.retry = { failure: "wrong bytes", previousReservation: first.id, verifiedFix: "verified fix" }; f.pin();
    expect(() => f.reserve(now + 90_000)).toThrow(/retry requires/);
    refresh(f, now + 90_000, "b".repeat(40)); f.evidence.retry.verifiedFix = ""; f.pin();
    expect(() => f.reserve(now + 90_000)).toThrow(/retry requires/);
    f.evidence.retry.verifiedFix = "verified fix"; f.evidence.retry.failure = "different unrecorded failure"; f.pin();
    expect(() => f.reserve(now + 90_000)).toThrow(/retry requires/);
  });

  it("invocation requires an unforgeable unused scope-bound token and cannot extend its deadline", () => {
    const f = fixture(); const token = f.reserve();
    expect(() => consumeScoutReservation({ ...token }, f.scope, "scripted-fixture", now)).toThrow(/unused exact-scope/);
    expect(() => consumeScoutReservation(token, { ...f.scope, runId: "other" }, "scripted-fixture", now)).toThrow();
    expect(() => consumeScoutReservation(token, f.scope, "live", now)).toThrow();
    token.deadline += 999_999; expect(() => consumeScoutReservation(token, f.scope, "scripted-fixture", now + 90_000)).toThrow();
    expect(consumeScoutReservation(token, f.scope, "scripted-fixture", now + 100)).toBe(now + 90_000);
    expect(() => consumeScoutReservation(token, f.scope, "scripted-fixture", now + 101)).toThrow();
    expect(admissionDigest(f.read())).toHaveLength(64);
  });
  it("rechecks restore and approval freshness after reservation but before invocation", () => {
    const f = fixture(); const old = path.join(f.root, "old-before-reservation.sqlite"); copyFileSync(f.stores.ledger, old);
    const token = f.reserve(); copyFileSync(old, f.stores.ledger);
    expect(() => consumeScoutReservation(token, f.scope, "scripted-fixture", now + 1)).toThrow(/restored history/);
    const changed = fixture(); const other = changed.reserve(); changed.evidence.assignment.implementer = "revoked replacement"; changed.pin();
    expect(() => consumeScoutReservation(other, changed.scope, "scripted-fixture", now + 1)).toThrow(/approval witness/);
  });
  it("cannot select a new live budget by replacing the fixture or choosing another store pair", () => {
    const f = fixture(); f.evidence.mode = "live"; f.evidence.capacity.evidence = "real"; f.pin();
    expect(() => reserveScoutAttempt(f.stores, f.evidence, f.scope, "live", now)).toThrow(/fixed host stores|trusted host configuration/);
    expect(f.read().attempts).toHaveLength(0);
  });
  it.each(["login refused", "quota exhausted", "isolation violation", "missing authority"])("never retries terminal refusal %s", (failure) => {
    const f = fixture(); const first = f.reserve();
    finishScoutAttempt(f.stores, f.evidence.isolation.pins.fixtureRoot, first, { failure, retryable: true }, now + 1);
    refresh(f, now + 90_000, "b".repeat(40)); f.evidence.retry = { failure, previousReservation: first.id, verifiedFix: "changed candidate" }; f.pin();
    expect(() => f.reserve(now + 90_000)).toThrow(/retry requires/);
  });
  it.each([null, { hasCredits: true, unlimited: false, balance: "50" }, { hasCredits: false, unlimited: true, balance: null }])("refuses unknown or available paid credit fallback %j", (credits) => {
    const f = fixture(); f.evidence.capacity.credits = credits; f.pin();
    expect(() => f.reserve()).toThrow(/subscription\/capacity evidence/);
  });
});
