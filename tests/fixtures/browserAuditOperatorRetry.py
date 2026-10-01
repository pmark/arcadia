"""Publication-retry fixture. Every Git/CLI process is intercepted."""
import hashlib
import json
import os
import pathlib
import sys
import unittest.mock

root, library, ask, mode = sys.argv[1:]
root, library, ask = pathlib.Path(root), pathlib.Path(library), pathlib.Path(ask)
identifier = "open-browser-audit-boundary-decision-847-2026-10-01"
descriptor = json.loads((library / (identifier + ".json")).read_text())
proposal = descriptor["agentAsk"]["proposal"]
archive = root / (".arcadia/asks/archive/agent-ask-" + proposal + ".yaml")
archive.parent.mkdir(parents=True)
archive.write_bytes(ask.read_bytes())
# A canonical applied receipt retains its fingerprint, but omits review.
applied = {"ok": True, "data": {"receipt": {
    "applied": True, "proposalRequestId": proposal, "intent": "decision",
    "previewFingerprint": descriptor["pinnedPreview"]
}}}
decision = root / descriptor["pinnedDecisionPath"]
decision.parent.mkdir(parents=True)
body = "fixture unresolved Decision\n"
decision.write_text(body + ("changed" if mode == "changed" else ""))
descriptor["pinnedDecisionSha256"] = hashlib.sha256(body.encode()).hexdigest()
descriptor_file = root / "descriptor.json"
descriptor_file.write_text(json.dumps(descriptor))
os.environ.update(ARCADIA_AUDIT_DECISION_RUN_DIR=str(root),
                  ARCADIA_AUDIT_DECISION_DESCRIPTOR=str(descriptor_file))
shell = (library / (identifier + ".sh")).read_text()
embedded = shell.split("<<'PYTHON' >\"$run_dir/run.log\" 2>&1\n")[1].split("\nPYTHON\n")[0]
source = embedded.replace(
    "root = pathlib.Path('/Users/pmark/Dev/MR/Arcadia/arcadia')",
    "root = pathlib.Path(" + repr(str(root)) + ")")
assert source != embedded


class Child:
    def __init__(self, args, **kwargs):
        assert kwargs["cwd"] == root
        self.args, self.returncode = args, 0

    def communicate(self, timeout):
        args = self.args
        if args[0] == "mise":
            assert "--apply" not in args, "Recovery must replay, never apply again"
            return json.dumps(applied), ""
        assert args[0] == "git"
        if args[1:] == ["rev-parse", "--show-toplevel"]:
            return str(root), ""
        if args[1:] == ["branch", "--show-current"]:
            return "main", ""
        if args[1:] == ["remote", "get-url", "origin"]:
            return "https://github.com/pmark/arcadia.git", ""
        if args[1:] == ["status", "--porcelain"]:
            return "", ""
        if args[1] == "ls-remote":
            return "remote refs/heads/main", ""
        if args[1:] == ["rev-parse", "HEAD"]:
            return "settlement", ""
        if args[1] == "merge-base":
            return "", ""
        if args[1] == "log":
            return ("unrelated" if mode == "unrelated" else
                    "chore(arcadia): settle " + proposal), ""
        if args[1] == "push":
            (root / "pushed").write_text("yes")
            return "published exact receipt", ""
        raise AssertionError("Unexpected command: " + repr(args))


with unittest.mock.patch("subprocess.Popen", Child):
    exec(compile(source, "operator-action", "exec"))
