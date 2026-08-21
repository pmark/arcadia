#!/bin/sh
# Stage the three demo notes in a LOCAL ingress root, ready for
# `arcadia ingress process` to pick up live.
#
# Local on purpose. The real source folder is in iCloud Drive, and iCloud sync
# is exactly the kind of dependency a live demo should not carry -- a note that
# has not finished downloading is invisible to the watcher. `--ingress-root`
# points the same watcher at a folder that is always there.
#
# The demo pass runs with `--source DemoNotes`, so every row it creates carries
# ingress_source='ingress:DemoNotes' and the undo can find them exactly.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${DEMO_INGRESS_ROOT:-$HOME/Dev/MR/Arcadia/demo-ingress}"
INBOX="$ROOT/DemoNotes/In"

rm -rf "$ROOT"
mkdir -p "$INBOX"
cp "$HERE/ingress-notes/pinterest.txt" "$INBOX/"
cp "$HERE/ingress-notes/intake-link.txt" "$INBOX/"
cp "$HERE/ingress-notes/weekly-digest.txt" "$INBOX/"

echo "Staged 3 notes in $INBOX"
ls -1 "$INBOX" | sed 's/^/  /'
echo
echo "Demo command:"
echo "  arcadia ingress process --ingress-root $ROOT --source DemoNotes --stable-seconds 0"
echo "Undo:"
echo "  scripts/demo/unseed-2026-08-21.sh --apply"
