# Filesystem layout

Arcadia runs under a dedicated non admin macOS user. That user owns a predictable local layout:

## Required paths

    ~/Arcadia
    ~/AI/models
    ~/AI/runtimes
    ~/AI/workspaces/private-rag
    ~/AI/workspaces/public-rag

## Guidance

1. Keep model weights out of cloud synced folders.
2. Keep private RAG data separate from public or test datasets.
3. Keep logs under ~/Library/Logs/Arcadia with restrictive permissions.
