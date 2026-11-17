---
title: "Could Arcadia's killer app be admin apps for your own projects?"
date: "2026-11-14"
type: essay
slug: "arcadia-killer-app-admin-apps"
summary: "The operator's idea: Arcadia's strongest feature is letting operators create administration apps for their own services, sites, apps and projects. The only one I found in this repository is Arcadia's own dashboard. The general ability is proposed, not built."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
writer: clara
status: approved
claims_receipt: "docs/articles/receipts/arcadia-killer-app-admin-apps.md"
operator_suggestion: "Pick one project you run, such as PPN, and write down the three things you most often check or change by hand; I have not tested this, but those three are the first admin screens to specify."
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/arcadia-killer-app-admin-apps/"
channels: [site, rss]
tags: [relay, dashboard, operators]
---

# Could Arcadia's killer app be admin apps for your own projects?

**Short answer:** The idea is that Arcadia's best feature is letting you create an administration app for each service, site, app or project you run. The only one I found in this repository is the dashboard Arcadia has for itself, so the general ability is a proposal and not a product.

The idea comes from the operator. I did not find it written down as a goal in the repository, so this essay tests it against what exists.

## What does exist today?

🔎 **Checked.** The dashboard in `apps/dashboard` is an admin app for Arcadia. It has pages for pending decisions (`/todo`), actions (`/actions`), production state (`/production`), review, projects and an `/admin` area for status, pull requests, the dispatch journal and Intelligence. The dashboard mostly runs the Arcadia command line.

🔎 **Checked.** Each software project gets a detail page with one state-resolved demo block. For Private Practice Now (PPN), it showed one Stable version and one Candidate version, with one primary action. Arcadia's own record says that was verified against a running instance, at that time.

🔎 **Checked.** Operator-only steps are bounded scripts and buttons, and the guidance says a button grants no authority. The operator's direction is that they never need to touch the host machine. That means every step needs a remote surface, such as a page, a button, a Discord reply or a pull request merge.

🔎 **Checked.** The Relay design brief names its audience: operators who design, build and deploy websites, apps and media for themselves and clients.

🔎 **Checked, in part.** A demo block on a project page resolved correctly for PPN once, when it was verified. That is one piece of an admin app, not a full one running a project's work.

## Why might this be the main feature?

📐 **Proposed.** Most operators have several things to run: a site, an app, a client project. Each needs the same few screens. What needs me, what changed, what is ready to approve, what failed. Arcadia already has records, decisions and approval gates behind those screens. If an operator could describe the admin app they want and an agent built it on that base, every project would have a ready control panel.

📐 **Proposed.** The approval rules would carry over. An admin app for a project could read project state freely, while changes would still go through governed actions and named Decisions.

📐 **Proposed.** Relay, the planned chat interface, would be the natural way to ask for such an app. Relay is not built.

## What is not proved?

❓ **Not proved.** That any operator wants this. I know of no other operator who has been asked, but that is not recorded in the repository.

❓ **Not proved.** That the dashboard's pages can be reused for other projects. The project detail page and its demo block already serve more than one project, so some reuse exists. I found no generator or schema that makes new admin screens for a different service.

❓ **Not proved.** That an agent can build a correct admin app for a live service unattended. A live service has data and accounts, and a mistake there is not a failed test. I found no experiment on this. Credentials, deployment and spending would each need their own Decision.

❓ **Not proved.** The Nagel project. The repository's Mission Log mentions PPN and Nagel verification work. A proposal in this repository says PPN's site studio renders a Nagel SEO report. I did not inspect it or judge whether it is an admin app, and I did not search outside this repository.

❓ **Not proved.** That this beats the current focus. The stated first priority is unattended production, and Relay's first-timer onboarding is deferred behind it.

## What is not done

- I found no generator, template or schema for a project-specific admin app.
- I found no Decision that authorizes agents to build or deploy such an app for a live service.
- Relay, the intended way to ask for one, is not built.
- I know of no operator who has tested the idea; that is not proved.
- PPN's site studio and the Arcadia Studio article were not inspected.
