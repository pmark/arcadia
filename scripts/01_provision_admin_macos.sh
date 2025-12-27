#!/usr/bin/env bash
set -euo pipefail

echo "Admin provisioning for Arcadia host"

echo "Checking FileVault status"
fdesetup status || true

echo "Enabling macOS firewall"
 /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
 /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on

echo "Installing Homebrew if missing"
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -d "/opt/homebrew/bin" ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

echo "Updating Homebrew"
brew update

echo "Installing baseline tools"
brew install git gh jq tree ripgrep fd

echo "Optional tooling for local AI and ops"
brew install python node

echo "Done"
echo "Next step is scripts/02_create_arcadia_user.sh"
