import type { JourneyPhase, PlanJourney, PlanJourneyAction } from "./journey-types";

/**
 * Sample rover missions for /workspace/feed. A fixture, not workspace
 * records: the shapes are the real `arcadia-plan-journey-v1` wire shape, so a
 * later read of `/api/journey/<project>/plan/<plan>` can replace this list
 * without changing the view. Add a mission by appending a `mission(...)`.
 */
const GENERATED_AT = "2030-01-01T12:00:00.000Z";

type Leg = [id: string, title: string, phase: JourneyPhase, headline: string, extra?: { yourMove?: string; since?: string; victories?: number; cleared?: number; open?: number }];

function action([id, title, phase, headline, extra = {}]: Leg, current: boolean): PlanJourneyAction {
  return {
    id,
    title,
    status: phase === "arrived" ? "done" : phase === "parked" || phase === "waiting" ? "open" : phase === "blocked" ? "blocked" : "in_progress",
    current,
    journey: {
      activity: { phase, headline, since: extra.since ?? null, yourMove: extra.yourMove ?? null },
      destination: { reached: phase === "arrived" },
      counts: { victories: extra.victories ?? (phase === "arrived" ? 1 : 0), cleared: extra.cleared ?? 0, open: extra.open ?? (phase === "blocked" ? 1 : 0) }
    }
  };
}

function mission(project: string, slug: string, milestone: string, active: boolean, legs: Leg[]): PlanJourney {
  const firstOpen = legs.findIndex(l => l[2] !== "arrived");
  const actions = legs.map((leg, i) => action(leg, i === firstOpen));
  return {
    schema: "arcadia-plan-journey-v1",
    generatedAt: GENERATED_AT,
    project,
    plan: { slug, milestone, active },
    context: {
      project: { name: project, goal: milestone, outcome: null, milestone },
      plan: { slug, milestone, active, position: firstOpen < 0 ? null : firstOpen + 1, total: legs.length, done: legs.filter(l => l[2] === "arrived").length },
      action: null
    },
    northStar: null,
    actions,
    warnings: []
  };
}

export const JOURNEY_FIXTURE: PlanJourney[] = [
  mission("arcadia", "unattended-production", "Two dependent Actions land with no operator step", true, [
    ["name-failing-preservation-check", "Name the failing preservation check", "arrived", "Landed in #1702", { victories: 1, cleared: 2 }],
    ["honor-policy-providers-at-launch", "Honor policy providers at launch", "in-review", "Review round 2 of 3 on the current head", { since: "2030-01-01T11:20:00.000Z", victories: 1, cleared: 1 }],
    ["refuse-packets-without-validation", "Refuse packets without validation commands", "driving", "Implementer on its second commit", { since: "2030-01-01T11:42:00.000Z" }],
    ["prove-two-action-unattended", "Prove two-Action unattended production", "waiting", "Waits on the two Actions before it"]
  ]),
  mission("arcadia", "operator-presence", "The operator shares how they are in one tap", false, [
    ["define-operator-presence-signal", "Define the operator presence signal", "launching", "Preparing an isolated worktree", { since: "2030-01-01T11:58:00.000Z" }],
    ["add-presence-profile-menu", "Add the Presence profile menu", "parked", "Parked until the signal lands"],
    ["drive-sky-from-system-status", "Drive the sky from system status", "parked", "Parked"]
  ]),
  mission("mission-control-site", "field-notes", "MartianRover Field Notes is published", true, [
    ["draft-first-note", "Draft the first field note", "arrived", "Landed in #44"],
    ["fix-feed-dates", "Fix feed dates", "repairing", "Repair round 1: a date test fails in CI", { since: "2030-01-01T10:05:00.000Z", cleared: 1, open: 1 }],
    ["publish-site", "Publish the site", "blocked", "Publishing needs your Decision", { yourMove: "Answer Decision 0017: publish now or after review", open: 1 }]
  ]),
  mission("moon-garden", "first-website", "A small garden on the web", true, [
    ["sketch-layout", "Sketch the layout", "arrived", "Landed in #3"],
    ["review-phone", "Review the page on a phone", "arrived", "Landed in #5"],
    ["add-planting-guide", "Add the planting guide", "arrived", "Landed in #8", { cleared: 1 }]
  ])
];

/** What a mission is doing overall, for its summary line: the first leg that is not done, or arrived. */
export function missionPhase(journey: PlanJourney): JourneyPhase {
  const order: JourneyPhase[] = ["blocked", "repairing", "in-review", "driving", "launching", "waiting", "parked"];
  const phases = journey.actions.map(a => a.journey.activity.phase);
  return order.find(p => phases.includes(p)) ?? "arrived";
}
