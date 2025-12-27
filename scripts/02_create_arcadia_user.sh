#!/usr/bin/env bash
set -euo pipefail

ARC_USER="${ARC_USER:-arcadia}"
ARC_FULLNAME="${ARC_FULLNAME:-Arcadia Service}"
ARC_PASSWORD="${ARC_PASSWORD:-}"

if [[ -z "${ARC_PASSWORD}" ]]; then
  echo "Set ARC_PASSWORD env var to create the user"
  echo "Example: ARC_PASSWORD='strong pass' sudo -E ./scripts/02_create_arcadia_user.sh"
  exit 1
fi

echo "Creating non admin user: ${ARC_USER}"

sysadminctl -addUser "${ARC_USER}" \
  -fullName "${ARC_FULLNAME}" \
  -password "${ARC_PASSWORD}" \
  -home "/Users/${ARC_USER}"

echo "Ensuring user is not admin"
dseditgroup -o edit -d "${ARC_USER}" -t user admin || true

echo "Recommended manual checks"
echo "1. Disable iCloud sign in for the Arcadia user"
echo "2. Enable Fast User Switching in Control Center settings"
echo "3. Log into the Arcadia user once before installing launchd agents"
