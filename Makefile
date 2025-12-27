SHELL := /bin/zsh

.PHONY: help admin arcadia-user launchd health

help:
	@echo "Targets:"
	@echo "  make admin        Provision host prerequisites as admin"
	@echo "  make arcadia-user  Bootstrap Arcadia user environment"
	@echo "  make launchd       Install and load launchd agents for Arcadia"
	@echo "  make health        Run basic health checks"

admin:
	@sudo ./scripts/01_provision_admin_macos.sh

arcadia-user:
	@./scripts/03_bootstrap_arcadia_user.sh

launchd:
	@./scripts/04_install_launchd_agents.sh

health:
	@./scripts/90_health_check.sh
