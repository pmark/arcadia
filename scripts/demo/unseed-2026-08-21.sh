#!/bin/sh
# Remove everything scripts/demo/seed-2026-08-21.sh created, and nothing else.
#
# Previews by default and changes nothing; pass --apply to delete. Both Back
# Burner rows are matched on source_ref='demo-2026-08-21', so this cannot touch
# an item captured any other way. The Action is matched on the id recorded at
# seed time, falling back to its exact title.

set -eu

MARKER="demo-2026-08-21"
INGRESS_SOURCE="ingress:DemoNotes"
# Ingress records its source on the Back Burner rows it creates, but not on the
# Actions -- work_items has no provenance column. The one Action the demo pass
# creates is matched on the note text instead, which ingress stores verbatim in
# raw_input. The phrase below appears only in scripts/demo/ingress-notes.
INGRESS_ACTION_MATCH="%Pinterest publishing path before the next batch of rebus shorts%"
INGRESS_ROOT="${DEMO_INGRESS_ROOT:-$HOME/Dev/MR/Arcadia/demo-ingress}"
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
echo "Rows created by the demo ingress pass (ingress_source='$INGRESS_SOURCE'):"
sqlite3 "$DB" "SELECT '  ' || id || '  ' || classification || '  ' || substr(original_input, 1, 60) FROM back_burner_items WHERE ingress_source = '$INGRESS_SOURCE';"
sqlite3 "$DB" "SELECT '  ' || id || '  Action  ' || substr(title, 1, 60) FROM work_items WHERE raw_input LIKE '$INGRESS_ACTION_MATCH';"
echo
echo "Staged notes folder: $INGRESS_ROOT"
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
DELETE FROM back_burner_items WHERE ingress_source = '$INGRESS_SOURCE';
DELETE FROM work_items WHERE raw_input LIKE '$INGRESS_ACTION_MATCH';
DELETE FROM work_items WHERE $ACTION_WHERE;
COMMIT;
SQL

rm -f "$STATE"
rm -rf "$INGRESS_ROOT"
echo "Deleted. Removed $STATE and $INGRESS_ROOT."
echo "Verify with: arcadia back-burner list --fired yes"
