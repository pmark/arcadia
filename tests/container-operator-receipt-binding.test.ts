import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise the actual dormant operator validator without executing its
// authority-writing entrypoint. Fixtures are temporary, never live Grants.
describe("operator receipt scope binding", () => {
  it("requires exact consumption and rejects stale authority on every field", () => {
    const result = spawnSync("python3", ["-c", String.raw`
import ast,json,pathlib,tempfile,uuid
source=pathlib.Path('artifacts/generated/operator-scripts/approve-scoped-container-audit-847-2026-10-02.sh').read_text().split('2>&1\n',1)[1].split('\nPY\n',1)[0]
tree=ast.parse(source)
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate_scoped_result')
exec(compile(ast.Module(body=[fn],type_ignores=[]),'operator-validator','exec'))
with tempfile.TemporaryDirectory() as folder:
 workspace=pathlib.Path(folder);active=workspace/'.arcadia/container-audit-grant.json';active.parent.mkdir()
 grant=json.loads(pathlib.Path('artifacts/evidence/issue-847-container-2026-10-02/proposed-grant.json').read_text())
 nonce=str(uuid.uuid4());consumed=active.parent/(active.name+'.'+nonce+'.consumed')
 expected=workspace/'artifacts/container-audits'/nonce/'receipt.json';expected.parent.mkdir(parents=True)
 receipt={'authority':grant['authority'],'ready':True,'removed':True};expected.write_text(json.dumps(receipt))
 response={'nonce':nonce,'receipt':str(expected),'ok':True,'ready':True}
 def refused():
  try:validate_scoped_result(response,grant,active,workspace)
  except (RuntimeError,ValueError):return True
  return False
 assert refused(), 'A replay must not succeed without consuming this Grant'
 consumed.write_text(json.dumps(grant));validate_scoped_result(response,grant,active,workspace)
 for field in ['project','revision','image','executorHash','snapshotHash','routes','viewports','expiresAt']:
  changed=json.loads(json.dumps(receipt));changed['authority'][field]='different';expected.write_text(json.dumps(changed));assert refused(),field
 expected.write_text(json.dumps(receipt))
 changed=json.loads(json.dumps(grant));changed['source']='different';consumed.write_text(json.dumps(changed));assert refused(),'source'
 consumed.write_text(json.dumps(grant));response['receipt']=str(workspace/'different.json');assert refused(),'receipt path'
 print('Exact consumption, eight authority fields, source and receipt path verified')
`], {encoding: "utf8"});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("eight authority fields");
  });
});
