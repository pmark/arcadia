# Disaster recovery

This is a short runbook for the most likely failures.

## Water spill or sudden device loss

1. Stop using the device.
2. Acquire replacement hardware.
3. Restore from the latest encrypted backup.
4. Recreate the Arcadia user if needed.
5. Run provisioning and bootstrap from this repo.
6. Restore Arcadia private workspaces and secrets.
7. Validate using scripts/90_health_check.sh.

## Partial disk corruption

1. Copy current logs if possible.
2. Restore Arcadia repos and workspaces from backup.
3. Re run bootstrap scripts to ensure permissions and runtime are correct.

## Credentials compromise

1. Rotate tokens and SSH keys.
2. Audit launchd agents and recent logs.
3. Restore from a known clean snapshot if unsure.
