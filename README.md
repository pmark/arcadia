# Arcadia Bootstrap Repo

This repository exists to make Arcadia installation, recovery, and ongoing operation predictable and repeatable.

## Scope

This repo covers:

1. Host setup on macOS
2. Creation and hardening of the Arcadia service user
3. Standard filesystem layout for local AI and Arcadia runtime
4. launchd agents for continuous background operation
5. Backup and restore guidance
6. Runbooks and operational checks

It does not contain private data, model weights, or personal account configuration.

## Quick start

1. Clone this repo on the Arcadia device.
2. Run admin provisioning scripts from an admin account.
3. Log into the Arcadia user once and run the Arcadia user bootstrap.
4. Install and load launchd agents.
5. Validate with the health checks.

See docs/runbook.md for the step by step flow.

## Directory conventions

Arcadia service user owns:

    ~/Arcadia
    ~/AI/models
    ~/AI/runtimes
    ~/AI/workspaces/private-rag
    ~/AI/workspaces/public-rag

See docs/filesystem-layout.md.

## Security stance

Arcadia runs as a dedicated non admin user with no iCloud and no personal data.

See docs/security-model.md.
