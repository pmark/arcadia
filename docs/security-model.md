# Security model

Arcadia uses host isolation and least privilege.

## Account separation

1. Admin account provisions system dependencies.
2. Personal account is for iCloud and daily work.
3. Arcadia service account runs background automation.

The Arcadia account is non admin and should not be signed into iCloud.

## Permissions

Arcadia owns its home directory and its AI workspace directories. Permissions should be restrictive.

## Continuous execution

Arcadia starts via launchd user agents and runs continuously while the Arcadia user session remains active.
