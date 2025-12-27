# Backup and restore

Arcadia reliability depends on fast restoration.

## Backup goals

1. You can replace a failed machine quickly.
2. You can restore Arcadia behavior predictably.
3. You can restore private datasets safely without accidental leakage.

## What to back up

1. This repository
2. Arcadia repos under the Arcadia service user
3. Arcadia configuration secrets stored locally
4. Private workspaces that contain important data

## What to treat differently

Model weights can be large. If bandwidth and time matter, treat models as cacheable assets.

## Recommended backup pattern

Use a three copy approach:

1. Local encrypted Time Machine to a dedicated external drive
2. Periodic encrypted clone to a second drive stored separately
3. Offsite encrypted copy for critical Arcadia configuration and datasets

## Restore drill

Do a quarterly restore drill:

1. Fresh user account
2. Clone this repo
3. Run admin provisioning
4. Run Arcadia user bootstrap
5. Restore secrets and private workspaces
6. Validate with health checks
