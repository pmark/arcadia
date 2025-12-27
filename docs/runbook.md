# Runbook

This is the step by step path for a new Arcadia install.

## Prerequisites

1. FileVault enabled
2. Admin account available
3. Fast User Switching enabled

## Install flow

1. Log into admin account
2. Clone this repo to a temporary location
3. Run:

   sudo ./scripts/01_provision_admin_macos.sh

4. Create Arcadia user:

   ARC_PASSWORD='set a strong password' sudo -E ./scripts/02_create_arcadia_user.sh

5. Log into the Arcadia user
6. Clone this repo to a stable location, recommended:

   ~/ArcadiaBootstrap

7. Run:

   make arcadia-user

8. Install and load launchd agents:

   make launchd

9. Validate:

   make health

## Notes

The Arcadia user must remain logged in for user level launchd agents to run continuously.
