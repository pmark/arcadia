import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { forkMock } = vi.hoisted(() => ({forkMock: vi.fn()}));
vi.mock("node:child_process", async importOriginal => ({...await importOriginal<typeof import("node:child_process")>(), fork: forkMock}));
import { containerAuditGrantAnswer, CONTAINER_AUDIT_REQUEST, processContainerAuditRequest, type HostAuditGrant } from "../src/sessions/containerAuditTransport.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); forkMock.mockReset(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "audit-worker-failure-")); roots.push(root);
  const repository = path.join(root,"repository"), workspace = path.join(root,"workspace"), workerEntrypoint = path.join(root,"runtime/scripts/worker.js");
  for (const p of [path.join(repository,".arcadia"),path.join(workspace,".arcadia"),path.dirname(workerEntrypoint),path.join(root,"runtime/src/sessions")]) mkdirSync(p,{recursive:true});
  writeFileSync(workerEntrypoint,"synthetic"); writeFileSync(path.join(root,"runtime/src/sessions/containerBrowserAudit.js"),"synthetic");
  const nonce="12345678-1234-1234-1234-123456789abc";
  const grant: HostAuditGrant={schema:"arcadia-container-audit-grant-v1",repository,source:root,decisionPath:path.join(root,"synthetic-decision.md"),authority:{schema:"arcadia-container-audit-authority-v1",project:"fixture",revision:"a".repeat(40),image:`sha256:${"b".repeat(64)}`,executorHash:createHash("sha256").update("synthetic").digest("hex"),snapshotHash:"c".repeat(64),routes:["/"],viewports:[{width:390,height:844}],expiresAt:new Date(Date.now()+60000).toISOString()}};
  writeFileSync(grant.decisionPath,`---\narcadia: v1\ntype: decision\nid: "0001"\nslug: synthetic\nproject: fixture\nstatus: approved\nquestion: Synthetic fixture only\ngap_type: missing-decision\nupdated: 2026-10-02\nanswer: ${JSON.stringify(containerAuditGrantAnswer(grant))}\n---\n# Synthetic\n`);
  writeFileSync(path.join(workspace,".arcadia/container-audit-grant.json"),JSON.stringify(grant));
  writeFileSync(path.join(repository,CONTAINER_AUDIT_REQUEST),JSON.stringify({nonce}));
  const child=new EventEmitter(); forkMock.mockReturnValue(child);
  const stderr=vi.spyOn(process.stderr,"write").mockReturnValue(true);
  processContainerAuditRequest(workspace,repository,{workerEntrypoint});
  return {workspace,nonce,child,stderr};
}
describe("host audit callback isolation",()=>{
  it("survives failure-receipt write errors after a child error",()=>{
    const f=fixture();
    mkdirSync(path.join(f.workspace,"artifacts/container-audits",f.nonce,"failure.json"));
    expect(()=>f.child.emit("error",new Error("Synthetic child failure"))).not.toThrow();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("failure receipt unavailable"));
  });
  it("survives response-directory loss after a successful child message",()=>{
    const f=fixture(); const directory=path.join(f.workspace,"artifacts/container-audit-responses");
    renameSync(directory,directory+".retained"); writeFileSync(directory,"Synthetic blocking file");
    expect(()=>f.child.emit("message",{ok:true,ready:true})).not.toThrow();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("response unavailable"));
  });
});
