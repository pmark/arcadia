#!/bin/sh
# Remove everything scripts/demo/seed-2026-08-21.sh created, and nothing else.
#
# Previews by default and changes nothing; pass --apply to delete. Both Back
# Burner rows are matched on source_ref='demo-2026-08-21', so this cannot touch
# an item captured any other way. The Action is matched on the id recorded at
# seed time, falling back to its exact title.

set -eu

MARKER="demo-2026-08-21"
WORKSPACE="${ARCADIA_WORKSPACE:-/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover}"
STATE="$WORKSPACE/.demo-2026-08-21.env"
DB="$WORKSPACE/database/arcadia.sqlite3"
TITLE="Deliver the 10-minute Arcadia demo to a technical peer"

APPLY="no"
[ "${1:-}" = "--apply" ] && APPLY="yes"

[ -f "$DB" ] || { echo "No database at $DB" >&2; exit 3; }

DEMO_ACTION=""
# shellcheck disable=SC1090
[ -f "$STATE" ] && . "$STATE"

if [ -n "${DEMO_ACTION:-}" ]; then
  ACTION_WHERE="id = '$DEMO_ACTION'"
else
  ACTION_WHERE="title = '$TITLE'"
fi

echo "Arcadia demo unseed — $WORKSPACE"
echo
echo "Back Burner items with source_ref='$MARKER':"
sqlite3 "$DB" "SELECT '  ' || id || '  ' || substr(original_input, 1, 72) FROM back_burner_items WHERE source_ref = '$MARKER';"
echo
echo "Actions matching $ACTION_WHERE:"
sqlite3 "$DB" "SELECT '  ' || id || '  ' || title || '  [' || status || ']' FROM work_items WHERE $ACTION_WHERE;"
echo

if [ "$APPLY" != "yes" ]; then
  echo "Nothing was changed. Re-run with --apply to delete the rows listed above."
  exit 0
fi

# Back Burner first: its surface_dependency_work_item_id would otherwise be
# nulled by the Action delete, losing the only link back to what fired it.
sqlite3 "$DB" <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM back_burner_items WHERE source_ref = '$MARKER';
DELETE FROM work_items WHERE $ACTION_WHERE;
COMMIT;
SQL

rm -f "$STATE"
echo "Deleted. Removed $STATE."
echo "Verify with: arcadia back-burner list --fired yes"
