# Arcadia Intelligence Bootstrap

This scaffold creates a generic v0.1 foundation for Arcadia Intelligence.

Run:

    bash scripts/bootstrap-arcadia-intelligence-v0.1.sh

Use `--force` only when intentionally replacing generated scaffold files.

After running the bootstrap, give Codex:

    docs/intelligence/CODEX_HANDOFF.md

The bootstrap deliberately avoids installing packages or modifying existing server
entry points because Codex must first align the implementation with Arcadia's
actual repository conventions.
