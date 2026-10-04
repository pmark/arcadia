"""Offline behavioral checks; no GitHub, credentials, workspace DB or inference."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("issue_packets.py")


class IssuePacketsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rows = [
            {"number": number, "title": f"Issue {number} – revisión",
             "body": "context " * 400, "updated_at": "2026-10-03T00:00:00Z",
             "html_url": f"https://github.com/example/project/issues/{number}",
             "state": "open", "labels": [{"name": "bug"}], "comments": 2}
            for number in range(1, 178)
        ]
        self.source = self.save("source.json", [self.rows[:100], self.rows[100:]])

    def save(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def run_helper(self, *args, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def triage(self):
        return [{"number": row["number"], "updated_at": row["updated_at"],
                 "route": "verify", "validity": "unknown", "area": "unknown",
                 "reason": "Needs current reproduction", "next_step": "Read reproduction",
                 "evidence": [], "action_refs": [], "revival_trigger": "Subsystem selected"}
                for row in self.rows]

    def test_paginated_inventory_preserves_full_bodies_and_excludes_prs(self):
        pr = dict(self.rows[0], number=999, pull_request={})
        self.save("source.json", [self.rows[:100], self.rows[100:] + [pr]])
        output = self.root / "packets"
        self.run_helper("prepare", self.source, output)
        snapshot = json.loads((output / "snapshot.json").read_text(encoding="utf-8"))
        self.assertEqual(snapshot, self.rows)
        packets = sorted(output.glob("packet-*.json"))
        self.assertEqual(len(packets), 9)
        entries = [row for packet in packets for row in json.loads(packet.read_text(encoding="utf-8"))]
        self.assertEqual([row["number"] for row in entries], list(range(1, 178)))
        self.assertTrue(all(row["body_truncated"] and not row["comments_loaded"] for row in entries))
        saved = (output / "snapshot.json").read_bytes()
        self.run_helper("prepare", self.source, output, success=False)
        self.assertEqual((output / "snapshot.json").read_bytes(), saved)

    def test_coverage_refuses_missing_duplicate_and_stale_results(self):
        snapshot = self.save("snapshot.json", self.rows)
        complete = self.triage()
        result = self.run_helper("validate", snapshot, self.save("triage.json", complete))
        self.assertFalse(json.loads(result.stdout)["evidence_truth_verified"])
        for rows in [complete[:-1], complete + [complete[0]],
                     [dict(complete[0], updated_at="stale")] + complete[1:]]:
            with self.subTest(first=rows[0], count=len(rows)):
                self.run_helper("validate", snapshot, self.save("triage.json", rows), success=False)

    def test_claims_need_evidence_and_unknowns_need_a_revival_trigger(self):
        snapshot = self.save("snapshot.json", self.rows)
        rows = self.triage()
        for first in [dict(rows[0], validity="resolved"),
                      dict(rows[0], revival_trigger=None),
                      dict(rows[0], canonical_issue=[123]),
                      dict(rows[0], canonical_issue="not-a-reference"),
                      dict(rows[0], action_refs=["guessed-title"]),
                      dict(rows[0], batch_id=1),
                      dict(rows[0], route="batch")]:
            self.run_helper("validate", snapshot, self.save("triage.json", [first] + rows[1:]), success=False)

    def test_api_errors_and_duplicate_inventory_do_not_create_output(self):
        for value in [{"message": "API denied"}, [self.rows[0], self.rows[0]]]:
            source = self.save("invalid.json", value)
            output = self.root / "invalid-output"
            self.run_helper("prepare", source, output, success=False)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
