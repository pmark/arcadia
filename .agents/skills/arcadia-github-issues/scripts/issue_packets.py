#!/usr/bin/env python3
"""Offline issue packet preparation and basic triage coverage checks. No network."""
import argparse
import json
import re
from pathlib import Path

ROUTES = {"verify", "fix", "batch", "close-candidate", "needs-operator"}
VALIDITY = {"present", "resolved", "duplicate", "superseded", "unknown"}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def issues(raw):
    if not isinstance(raw, list):
        raise ValueError("Expected a JSON array, not an API error or search object")
    rows = [item for page in raw for item in page] if raw and isinstance(raw[0], list) else raw
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("Expected issue objects in every page")
    rows = [row for row in rows if "pull_request" not in row]
    seen = set()
    for row in rows:
        number = row.get("number")
        if type(number) is not int or number <= 0 or number in seen:
            raise ValueError(f"Invalid or duplicate issue number: {number}")
        seen.add(number)
        for key in ("title", "updated_at", "html_url"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise ValueError(f"Issue {number} lacks {key}")
        if row.get("state") != "open":
            raise ValueError(f"Issue {number} is not open in this snapshot")
        if row.get("body") is not None and not isinstance(row["body"], str):
            raise ValueError(f"Issue {number} has a non-text body")
    return sorted(rows, key=lambda row: row["number"])


def write(path, data):
    # Exclusive creation prevents a rerun from erasing saved packets/results.
    with path.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def compact(row, body_limit):
    body = row.get("body") or ""
    trimmed = len(body) > body_limit
    excerpt = body if not trimmed else body[:body_limit // 2] + "\n[EXCERPT GAP]\n" + body[-body_limit // 2:]
    return {
        "number": row["number"], "title": row["title"],
        "url": row["html_url"], "updated_at": row["updated_at"],
        "labels": [label["name"] if isinstance(label, dict) else label for label in row.get("labels", [])],
        "comment_count": row.get("comments"), "body_excerpt": excerpt,
        "body_truncated": trimmed, "comments_loaded": False,
    }


def prepare(args):
    rows = issues(read(args.source))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    write(output / "snapshot.json", rows)
    index = [compact(row, args.body_limit) for row in rows]
    write(output / "index.json", [{key: value for key, value in row.items() if key != "body_excerpt"} for row in index])
    for offset in range(0, len(index), args.batch_size):
        write(output / f"packet-{offset // args.batch_size + 1:03d}.json", index[offset:offset + args.batch_size])
    print(json.dumps({"issues": len(rows), "packets": (len(rows) + args.batch_size - 1) // args.batch_size, "output": str(output.resolve()), "live_completeness_verified": False}))


def validate(args):
    snapshot = {row["number"]: row for row in issues(read(args.snapshot))}
    rows = read(args.triage)
    if not isinstance(rows, list):
        raise ValueError("triage.json must be an array")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each triage row must be an object")
        number = row.get("number")
        if type(number) is not int or number not in snapshot or number in seen:
            raise ValueError(f"Unexpected or duplicate triage number: {number}")
        seen.add(number)
        if row.get("updated_at") != snapshot[number]["updated_at"]:
            raise ValueError(f"Issue {number}: snapshot timestamp differs")
        if row.get("route") not in ROUTES or row.get("validity") not in VALIDITY:
            raise ValueError(f"Issue {number}: invalid route or validity")
        for key in ("area", "reason", "next_step"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise ValueError(f"Issue {number}: missing {key}")
        evidence = row.get("evidence")
        if not isinstance(evidence, list) or any(not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key].strip() for key in ("source", "observation")) for item in evidence):
            raise ValueError(f"Issue {number}: malformed evidence")
        if row["validity"] != "unknown" and not evidence:
            raise ValueError(f"Issue {number}: validity claim lacks evidence")
        for key in ("canonical_issue", "batch_id", "revival_trigger"):
            value = row.get(key)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"Issue {number}: {key} must be a nonempty string or null")
        canonical = row.get("canonical_issue")
        if canonical is not None and not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*", canonical):
            raise ValueError(f"Issue {number}: malformed canonical issue reference")
        action_refs = row.get("action_refs", [])
        if not isinstance(action_refs, list) or any(not isinstance(ref, str) or not re.fullmatch(r"plan/[a-z0-9]+(?:-[a-z0-9]+)*#[a-z0-9]+(?:-[a-z0-9]+)*", ref) for ref in action_refs):
            raise ValueError(f"Issue {number}: malformed Action references")
        if row["validity"] == "duplicate" and not row.get("canonical_issue"):
            raise ValueError(f"Issue {number}: duplicate lacks canonical reference")
        if row["route"] == "batch" and not row.get("batch_id"):
            raise ValueError(f"Issue {number}: batch lacks batch_id")
        if row["validity"] == "unknown" and not row.get("revival_trigger"):
            raise ValueError(f"Issue {number}: unknown lacks verification trigger")
    missing = sorted(set(snapshot) - seen)
    if missing:
        raise ValueError(f"Missing triage rows: {missing}")
    print(json.dumps({"issues": len(rows), "coverage": "complete-for-snapshot", "evidence_truth_verified": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("source")
    prep.add_argument("output")
    prep.add_argument("--batch-size", type=int, default=20)
    prep.add_argument("--body-limit", type=int, default=1000)
    check = commands.add_parser("validate")
    check.add_argument("snapshot")
    check.add_argument("triage")
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            if args.batch_size < 1 or args.body_limit < 2:
                raise ValueError("batch-size must be positive; body-limit must be at least 2")
            prepare(args)
        else:
            validate(args)
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"issue_packets: {error}\n")


if __name__ == "__main__":
    main()
