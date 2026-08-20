#!/bin/sh
# Seed the state the 2026-08-21 demo needs, using only Arcadia's public CLI.
#
# Everything this creates is a real idea that came out of preparing the demo,
# and every Back Burner row carries source_ref=demo-2026-08-21 so the undo is
# exact. See scripts/demo/unseed-2026-08-21.sh.
#
# Idempotent: re-running when the marker file exists refuses rather than
# creating a second copy.

set -eu

MARKER="demo-2026-08-21"
WORKSPACE="${ARCADIA_WORKSPACE:-/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover}"
STATE="$WORKSPACE/.demo-2026-08-21.env"
ARCADIA_PROJECT="${DEMO_PROJECT:-proj_ccdbfb22a7e4415ca7}"
SURFACE_DATE="${DEMO_SURFACE_DATE:-2026-08-21}"

if [ -f "$STATE" ]; then
  echo "Already seeded: $STATE" >&2
  echo "Run scripts/demo/unseed-2026-08-21.sh --apply first if you want a clean re-seed." >&2
  exit 2
fi

# Read one dotted path out of an Arcadia --json response on stdin.
json_field() {
  python3 -c 'import sys,json
value = json.load(sys.stdin)
for key in sys.argv[1].split("."):
    value = value[key]
print(value)' "$1"
}

echo "Seeding demo state into $WORKSPACE"

# 1. The Action the operator genuinely completes at the end of the demo.
DEMO_ACTION=$(arcadia capture \
  --workspace "$WORKSPACE" \
  --project "$ARCADIA_PROJECT" \
  --text "Deliver the 10-minute Arcadia demo to a technical peer" \
  --json 2>/dev/null | json_field data.workItem.id)

arcadia work update "$DEMO_ACTION" \
  --workspace "$WORKSPACE" \
  --responsibility autonomous \
  --queue work_queue \
  --status in_progress \
  --effort short \
  --clarification-status clarified \
  --next-action "Run the run-sheet in docs/demo/2026-08-21-run-sheet.md end to end, live." \
  >/dev/null 2>&1

echo "  Action        $DEMO_ACTION  Deliver the 10-minute Arcadia demo to a technical peer"

# 2. Fires LIVE, when the Action above is marked done in front of the audience.
BB_RETRO=$(arcadia ask \
  "Add a demo retro note to Arcadia covering what landed and what did not" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project "$ARCADIA_PROJECT" \
  --surface-dependency "$DEMO_ACTION" \
  --dependency-status done \
  --source-ref "$MARKER" \
  --tag quick-win \
  --json 2>/dev/null | json_field data.backBurnerItemId)

echo "  Back Burner   $BB_RETRO  fires when $DEMO_ACTION is done"

# 3. Already fired by the time the demo starts: captured 2026-08-20, told to
#    come back on 2026-08-21.
BB_BRIEF=$(arcadia ask \
  "Add a --brief flag to arcadia docket that prints the current Action without the constitution block, for screen sharing" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project "$ARCADIA_PROJECT" \
  --surface-date "$SURFACE_DATE" \
  --source-ref "$MARKER" \
  --tag quick-win \
  --json 2>/dev/null | json_field data.backBurnerItemId)

echo "  Back Burner   $BB_BRIEF  fires on $SURFACE_DATE"

cat > "$STATE" <<STATEFILE
# Written by scripts/demo/seed-2026-08-21.sh. Source this before the demo.
export ARCADIA_WORKSPACE="$WORKSPACE"
export DEMO_ACTION="$DEMO_ACTION"
export DEMO_BB_RETRO="$BB_RETRO"
export DEMO_BB_BRIEF="$BB_BRIEF"
STATEFILE

echo
echo "Wrote $STATE"
echo "Pre-flight:  . $STATE"
echo "Undo:        scripts/demo/unseed-2026-08-21.sh --apply"
