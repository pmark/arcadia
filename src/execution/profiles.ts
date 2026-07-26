import type { WorkClassification } from "../domain/constants.js";

export const EXECUTION_PROFILE_SCHEMA = "arcadia.execution/v1" as const;

export const CAPABILITY_TIERS = [
  "c1_bounded",
  "c2_integrated",
  "c3_systems",
  "c4_critical"
] as const;
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];

export const REASONING_EFFORTS = [
  "e1_brief",
  "e2_standard",
  "e3_deep",
  "e4_rigorous"
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const CONTEXT_SCOPES = ["local", "project", "cross_system"] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];

export const CONTEXT_STAGING_POLICIES = ["allowed", "forbidden"] as const;
export type ContextStagingPolicy = (typeof CONTEXT_STAGING_POLICIES)[number];

export const TOOL_REQUIREMENTS = ["forbidden", "optional", "required"] as const;
export type ToolRequirement = (typeof TOOL_REQUIREMENTS)[number];

export const DATA_LOCALITY_REQUIREMENTS = ["any", "local_only"] as const;
export type DataLocalityRequirement = (typeof DATA_LOCALITY_REQUIREMENTS)[number];

export const AUTONOMY_LEVELS = ["advise", "draft", "bounded_write", "managed_execute"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const DELEGATION_POLICIES = ["prohibited", "allowed"] as const;
export type DelegationPolicy = (typeof DELEGATION_POLICIES)[number];

export const PARALLELISM_POLICIES = ["serial", "independent_only"] as const;
export type ParallelismPolicy = (typeof PARALLELISM_POLICIES)[number];

export const REVIEW_INDEPENDENCE_LEVELS = [
  "not_required",
  "separate_run",
  "separate_provider"
] as const;
export type ReviewIndependence = (typeof REVIEW_INDEPENDENCE_LEVELS)[number];

export const EXECUTION_PHASES = ["planning", "implementation", "review", "verification"] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export const EXECUTION_ESCALATION_TRIGGERS = [
  "public_or_persisted_contract",
  "independently_deployed_system",
  "cross_repository_change",
  "difficult_verification",
  "security_boundary",
  "privacy_sensitive_data",
  "credentials_required",
  "production_data",
  "financial_action",
  "destructive_or_irreversible_change"
] as const;
export type ExecutionEscalationTrigger = (typeof EXECUTION_ESCALATION_TRIGGERS)[number];

export const EXECUTION_PROFILE_NAMES = [
  "localized_edit",
  "routine_implementation",
  "systems_change",
  "sensitive_change",
  "operator_decision_framing"
] as const;
export type ExecutionProfileName = (typeof EXECUTION_PROFILE_NAMES)[number];

export interface ExecutionContextRequirement {
  scope: ContextScope;
  required: string[];
  staging: ContextStagingPolicy;
}

export interface ResolvedExecutionProfile {
  capability: CapabilityTier;
  effort: ReasoningEffort;
  context: ExecutionContextRequirement;
  tools: ToolRequirement;
  dataLocality: DataLocalityRequirement;
  autonomy: AutonomyLevel;
  delegation: DelegationPolicy;
  parallelism: ParallelismPolicy;
  reviewIndependence: ReviewIndependence;
  underpoweredRisk: string;
}

export interface ExecutionProfileOverride {
  capability?: CapabilityTier;
  effort?: ReasoningEffort;
  context?: Partial<ExecutionContextRequirement>;
  tools?: ToolRequirement;
  dataLocality?: DataLocalityRequirement;
  autonomy?: AutonomyLevel;
  delegation?: DelegationPolicy;
  parallelism?: ParallelismPolicy;
  reviewIndependence?: ReviewIndependence;
  underpoweredRisk?: string;
}

export interface ExecutionRequirement {
  schema: typeof EXECUTION_PROFILE_SCHEMA;
  profile: ExecutionProfileName;
  context?: Partial<ExecutionContextRequirement>;
  underpoweredRisk?: string;
  phases: Partial<Record<ExecutionPhase, ExecutionProfileOverride>>;
}

export interface ResolvedExecutionRequirement {
  schema: typeof EXECUTION_PROFILE_SCHEMA;
  profile: ExecutionProfileName;
  baseline: ResolvedExecutionProfile;
  phases: Partial<Record<ExecutionPhase, ResolvedExecutionProfile>>;
}

export interface ExecutionProfileValidationIssue {
  field: string;
  message: string;
}

export interface ExecutionProfileParseResult {
  requirement: ExecutionRequirement | null;
  resolved: ResolvedExecutionRequirement | null;
  issues: ExecutionProfileValidationIssue[];
}

export interface ExecutionEscalationEvaluation {
  required: boolean;
  target: ResolvedExecutionProfile;
  triggers: ExecutionEscalationTrigger[];
  authorityRequired: boolean;
}

export const NAMED_EXECUTION_PROFILES: Record<ExecutionProfileName, ResolvedExecutionProfile> = {
  localized_edit: {
    capability: "c1_bounded",
    effort: "e1_brief",
    context: { scope: "local", required: [], staging: "allowed" },
    tools: "required",
    dataLocality: "any",
    autonomy: "bounded_write",
    delegation: "allowed",
    parallelism: "independent_only",
    reviewIndependence: "not_required",
    underpoweredRisk: "The edit may be incomplete or mechanically inconsistent."
  },
  routine_implementation: {
    capability: "c2_integrated",
    effort: "e2_standard",
    context: { scope: "project", required: [], staging: "allowed" },
    tools: "required",
    dataLocality: "any",
    autonomy: "bounded_write",
    delegation: "allowed",
    parallelism: "independent_only",
    reviewIndependence: "not_required",
    underpoweredRisk: "The implementation may miss related behavior or tests."
  },
  systems_change: {
    capability: "c3_systems",
    effort: "e3_deep",
    context: { scope: "project", required: [], staging: "allowed" },
    tools: "required",
    dataLocality: "any",
    autonomy: "bounded_write",
    delegation: "allowed",
    parallelism: "independent_only",
    reviewIndependence: "separate_run",
    underpoweredRisk: "Contract or architectural consequences may be missed."
  },
  sensitive_change: {
    capability: "c4_critical",
    effort: "e4_rigorous",
    context: { scope: "cross_system", required: [], staging: "forbidden" },
    tools: "required",
    dataLocality: "local_only",
    autonomy: "bounded_write",
    delegation: "prohibited",
    parallelism: "serial",
    reviewIndependence: "separate_run",
    underpoweredRisk: "A mistake may expose data, weaken controls, or cause irreversible harm."
  },
  operator_decision_framing: {
    capability: "c2_integrated",
    effort: "e3_deep",
    context: { scope: "project", required: [], staging: "allowed" },
    tools: "optional",
    dataLocality: "any",
    autonomy: "advise",
    delegation: "allowed",
    parallelism: "independent_only",
    reviewIndependence: "not_required",
    underpoweredRisk: "Relevant options or consequences may be omitted."
  }
};

const CAPABILITY_RANK = rank(CAPABILITY_TIERS);
const EFFORT_RANK = rank(REASONING_EFFORTS);
const CONTEXT_RANK = rank(CONTEXT_SCOPES);
const REVIEW_RANK = rank(REVIEW_INDEPENDENCE_LEVELS);
const PROHIBITED_VENDOR_FIELDS = new Set(["model", "model_id", "modelId", "provider", "provider_model"]);

export function parseExecutionRequirement(
  raw: unknown,
  responsibility: WorkClassification
): ExecutionProfileParseResult {
  const issues: ExecutionProfileValidationIssue[] = [];
  if (!isRecord(raw)) {
    return {
      requirement: null,
      resolved: null,
      issues: [{ field: "execution", message: "`execution` must be a mapping." }]
    };
  }

  for (const key of Object.keys(raw)) {
    if (PROHIBITED_VENDOR_FIELDS.has(key)) {
      issues.push({
        field: `execution.${key}`,
        message: "Authoritative plans must not contain provider or model identifiers; use a provider adapter."
      });
    }
  }

  const schema = raw.schema;
  if (schema !== EXECUTION_PROFILE_SCHEMA) {
    issues.push({
      field: "execution.schema",
      message: `Execution schema must be "${EXECUTION_PROFILE_SCHEMA}".`
    });
  }

  const profile = enumValue(raw.profile, EXECUTION_PROFILE_NAMES);
  if (!profile) {
    issues.push({
      field: "execution.profile",
      message: `Execution profile must be one of: ${EXECUTION_PROFILE_NAMES.join(", ")}.`
    });
  }

  const context = parseContextOverride(raw.context, "execution.context", issues);
  const underpoweredRisk = optionalNonEmptyString(raw.underpowered_risk, "execution.underpowered_risk", issues);
  const phases = parsePhaseOverrides(raw.phases, issues);

  if (issues.length > 0 || !profile || schema !== EXECUTION_PROFILE_SCHEMA) {
    return { requirement: null, resolved: null, issues };
  }

  const requirement: ExecutionRequirement = {
    schema,
    profile,
    context,
    underpoweredRisk,
    phases
  };
  const resolved = resolveExecutionRequirement(requirement, responsibility, issues);
  return { requirement, resolved: issues.length === 0 ? resolved : null, issues };
}

export function resolveExecutionRequirement(
  requirement: ExecutionRequirement,
  responsibility: WorkClassification,
  issues: ExecutionProfileValidationIssue[] = []
): ResolvedExecutionRequirement {
  const named = NAMED_EXECUTION_PROFILES[requirement.profile];
  const baseline = applyOverride(named, {
    context: requirement.context,
    underpoweredRisk: requirement.underpoweredRisk
  });
  validateAuthorityCompatibility(baseline, responsibility, "execution", issues);

  const phases: Partial<Record<ExecutionPhase, ResolvedExecutionProfile>> = {};
  for (const phase of EXECUTION_PHASES) {
    const override = requirement.phases[phase];
    if (!override && phase !== "planning" && phase !== "review") continue;
    const resolved = applyOverride(defaultForPhase(baseline, phase), override ?? {});
    rejectWeakenedRequirement(baseline, resolved, phase, issues);
    validateAuthorityCompatibility(resolved, responsibility, `execution.phases.${phase}`, issues);
    phases[phase] = resolved;
  }

  return {
    schema: requirement.schema,
    profile: requirement.profile,
    baseline,
    phases
  };
}

function defaultForPhase(
  baseline: ResolvedExecutionProfile,
  phase: ExecutionPhase
): ResolvedExecutionProfile {
  if (phase === "planning") {
    return {
      ...baseline,
      autonomy: AUTONOMY_LEVELS.indexOf(baseline.autonomy) <= AUTONOMY_LEVELS.indexOf("draft")
        ? baseline.autonomy
        : "draft"
    };
  }
  if (phase === "review") {
    return { ...baseline, autonomy: "advise" };
  }
  return baseline;
}

export function minimumCapability(
  left: CapabilityTier,
  right: CapabilityTier
): CapabilityTier {
  return CAPABILITY_RANK[left] >= CAPABILITY_RANK[right] ? left : right;
}

export function minimumEffort(left: ReasoningEffort, right: ReasoningEffort): ReasoningEffort {
  return EFFORT_RANK[left] >= EFFORT_RANK[right] ? left : right;
}

export function evaluateExecutionEscalation(
  current: ResolvedExecutionProfile,
  triggers: ExecutionEscalationTrigger[]
): ExecutionEscalationEvaluation {
  const architectureTriggers = new Set<ExecutionEscalationTrigger>([
    "public_or_persisted_contract",
    "independently_deployed_system",
    "cross_repository_change",
    "difficult_verification"
  ]);
  const criticalTriggers = new Set<ExecutionEscalationTrigger>([
    "security_boundary",
    "privacy_sensitive_data",
    "credentials_required",
    "production_data",
    "financial_action",
    "destructive_or_irreversible_change"
  ]);
  const authorityTriggers = new Set<ExecutionEscalationTrigger>([
    "credentials_required",
    "production_data",
    "financial_action",
    "destructive_or_irreversible_change"
  ]);
  const needsCritical = triggers.some((trigger) => criticalTriggers.has(trigger));
  const needsSystems = needsCritical || triggers.some((trigger) => architectureTriggers.has(trigger));
  const target: ResolvedExecutionProfile = {
    ...current,
    capability: needsCritical
      ? minimumCapability(current.capability, "c4_critical")
      : needsSystems
        ? minimumCapability(current.capability, "c3_systems")
        : current.capability,
    effort: needsCritical
      ? minimumEffort(current.effort, "e4_rigorous")
      : needsSystems
        ? minimumEffort(current.effort, "e3_deep")
        : current.effort,
    context: {
      ...current.context,
      scope: needsCritical || triggers.includes("cross_repository_change")
        ? "cross_system"
        : current.context.scope === "local" && needsSystems
          ? "project"
          : current.context.scope,
      staging: needsCritical ? "forbidden" : current.context.staging
    },
    dataLocality: needsCritical ? "local_only" : current.dataLocality,
    delegation: needsCritical ? "prohibited" : current.delegation,
    parallelism: needsCritical ? "serial" : current.parallelism,
    reviewIndependence: needsSystems && current.reviewIndependence === "not_required"
      ? "separate_run"
      : current.reviewIndependence
  };
  return {
    required:
      target.capability !== current.capability ||
      target.effort !== current.effort ||
      target.context.scope !== current.context.scope ||
      target.context.staging !== current.context.staging ||
      target.dataLocality !== current.dataLocality ||
      target.delegation !== current.delegation ||
      target.parallelism !== current.parallelism ||
      target.reviewIndependence !== current.reviewIndependence,
    target,
    triggers,
    authorityRequired: triggers.some((trigger) => authorityTriggers.has(trigger))
  };
}

export function executionRequirementToPortableValue(
  requirement: ExecutionRequirement
): Record<string, unknown> {
  return {
    schema: requirement.schema,
    profile: requirement.profile,
    context: requirement.context,
    underpowered_risk: requirement.underpoweredRisk,
    phases: Object.fromEntries(
      Object.entries(requirement.phases).map(([phase, override]) => [
        phase,
        {
          capability: override.capability,
          effort: override.effort,
          context: override.context,
          tools: override.tools,
          data_locality: override.dataLocality,
          autonomy: override.autonomy,
          delegation: override.delegation,
          parallelism: override.parallelism,
          review_independence: override.reviewIndependence,
          underpowered_risk: override.underpoweredRisk
        }
      ])
    )
  };
}

function parsePhaseOverrides(
  raw: unknown,
  issues: ExecutionProfileValidationIssue[]
): Partial<Record<ExecutionPhase, ExecutionProfileOverride>> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    issues.push({ field: "execution.phases", message: "`phases` must be a mapping." });
    return {};
  }

  const phases: Partial<Record<ExecutionPhase, ExecutionProfileOverride>> = {};
  for (const [phaseName, phaseRaw] of Object.entries(raw)) {
    if (!EXECUTION_PHASES.includes(phaseName as ExecutionPhase)) {
      issues.push({
        field: `execution.phases.${phaseName}`,
        message: `Execution phase must be one of: ${EXECUTION_PHASES.join(", ")}.`
      });
      continue;
    }
    if (!isRecord(phaseRaw)) {
      issues.push({
        field: `execution.phases.${phaseName}`,
        message: "Execution phase override must be a mapping."
      });
      continue;
    }
    for (const key of Object.keys(phaseRaw)) {
      if (PROHIBITED_VENDOR_FIELDS.has(key)) {
        issues.push({
          field: `execution.phases.${phaseName}.${key}`,
          message: "Authoritative plans must not contain provider or model identifiers; use a provider adapter."
        });
      }
    }
    const field = `execution.phases.${phaseName}`;
    phases[phaseName as ExecutionPhase] = {
      capability: optionalEnumValue(phaseRaw.capability, CAPABILITY_TIERS, `${field}.capability`, issues),
      effort: optionalEnumValue(phaseRaw.effort, REASONING_EFFORTS, `${field}.effort`, issues),
      context: parseContextOverride(phaseRaw.context, `${field}.context`, issues),
      tools: optionalEnumValue(phaseRaw.tools, TOOL_REQUIREMENTS, `${field}.tools`, issues),
      dataLocality: optionalEnumValue(
        phaseRaw.data_locality,
        DATA_LOCALITY_REQUIREMENTS,
        `${field}.data_locality`,
        issues
      ),
      autonomy: optionalEnumValue(phaseRaw.autonomy, AUTONOMY_LEVELS, `${field}.autonomy`, issues),
      delegation: optionalEnumValue(
        phaseRaw.delegation,
        DELEGATION_POLICIES,
        `${field}.delegation`,
        issues
      ),
      parallelism: optionalEnumValue(
        phaseRaw.parallelism,
        PARALLELISM_POLICIES,
        `${field}.parallelism`,
        issues
      ),
      reviewIndependence: optionalEnumValue(
        phaseRaw.review_independence,
        REVIEW_INDEPENDENCE_LEVELS,
        `${field}.review_independence`,
        issues
      ),
      underpoweredRisk: optionalNonEmptyString(
        phaseRaw.underpowered_risk,
        `${field}.underpowered_risk`,
        issues
      )
    };
  }
  return phases;
}

function parseContextOverride(
  raw: unknown,
  field: string,
  issues: ExecutionProfileValidationIssue[]
): Partial<ExecutionContextRequirement> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    issues.push({ field, message: "Execution context must be a mapping." });
    return undefined;
  }
  return {
    scope: optionalEnumValue(raw.scope, CONTEXT_SCOPES, `${field}.scope`, issues),
    required: optionalStringArray(raw.required, `${field}.required`, issues),
    staging: optionalEnumValue(raw.staging, CONTEXT_STAGING_POLICIES, `${field}.staging`, issues)
  };
}

function applyOverride(
  baseline: ResolvedExecutionProfile,
  override: ExecutionProfileOverride
): ResolvedExecutionProfile {
  return {
    capability: override.capability ?? baseline.capability,
    effort: override.effort ?? baseline.effort,
    context: {
      scope: override.context?.scope ?? baseline.context.scope,
      required: override.context?.required ?? baseline.context.required,
      staging: override.context?.staging ?? baseline.context.staging
    },
    tools: override.tools ?? baseline.tools,
    dataLocality: override.dataLocality ?? baseline.dataLocality,
    autonomy: override.autonomy ?? baseline.autonomy,
    delegation: override.delegation ?? baseline.delegation,
    parallelism: override.parallelism ?? baseline.parallelism,
    reviewIndependence: override.reviewIndependence ?? baseline.reviewIndependence,
    underpoweredRisk: override.underpoweredRisk ?? baseline.underpoweredRisk
  };
}

function rejectWeakenedRequirement(
  baseline: ResolvedExecutionProfile,
  phase: ResolvedExecutionProfile,
  phaseName: ExecutionPhase,
  issues: ExecutionProfileValidationIssue[]
): void {
  const field = `execution.phases.${phaseName}`;
  if (CAPABILITY_RANK[phase.capability] < CAPABILITY_RANK[baseline.capability]) {
    issues.push({
      field: `${field}.capability`,
      message: `${phase.capability} is below the action minimum ${baseline.capability}.`
    });
  }
  if (EFFORT_RANK[phase.effort] < EFFORT_RANK[baseline.effort]) {
    issues.push({
      field: `${field}.effort`,
      message: `${phase.effort} is below the action minimum ${baseline.effort}.`
    });
  }
  if (CONTEXT_RANK[phase.context.scope] < CONTEXT_RANK[baseline.context.scope]) {
    issues.push({
      field: `${field}.context.scope`,
      message: `${phase.context.scope} is below the action minimum ${baseline.context.scope}.`
    });
  }
  if (baseline.context.staging === "forbidden" && phase.context.staging === "allowed") {
    issues.push({
      field: `${field}.context.staging`,
      message: "Phase context staging cannot be allowed when the action minimum forbids it."
    });
  }
  if (baseline.dataLocality === "local_only" && phase.dataLocality === "any") {
    issues.push({
      field: `${field}.data_locality`,
      message: "Phase data locality cannot be widened beyond the action minimum local_only."
    });
  }
  if (REVIEW_RANK[phase.reviewIndependence] < REVIEW_RANK[baseline.reviewIndependence]) {
    issues.push({
      field: `${field}.review_independence`,
      message: `${phase.reviewIndependence} is below the action minimum ${baseline.reviewIndependence}.`
    });
  }
}

function validateAuthorityCompatibility(
  profile: ResolvedExecutionProfile,
  responsibility: WorkClassification,
  field: string,
  issues: ExecutionProfileValidationIssue[]
): void {
  if (
    responsibility === "requires_review" &&
    (profile.autonomy === "bounded_write" || profile.autonomy === "managed_execute")
  ) {
    issues.push({
      field: `${field}.autonomy`,
      message: `Responsibility "requires_review" permits only advise or draft autonomy, not ${profile.autonomy}.`
    });
  }
  if (responsibility === "blocked" && profile.autonomy !== "advise") {
    issues.push({
      field: `${field}.autonomy`,
      message: `Responsibility "blocked" permits only advise autonomy, not ${profile.autonomy}.`
    });
  }
}

function rank<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value, index) => [value, index])) as Record<T, number>;
}

function enumValue<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  return typeof raw === "string" && allowed.includes(raw as T) ? raw as T : null;
}

function optionalEnumValue<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  field: string,
  issues: ExecutionProfileValidationIssue[]
): T | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = enumValue(raw, allowed);
  if (!value) {
    issues.push({ field, message: `Value must be one of: ${allowed.join(", ")}.` });
    return undefined;
  }
  return value;
}

function optionalNonEmptyString(
  raw: unknown,
  field: string,
  issues: ExecutionProfileValidationIssue[]
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    issues.push({ field, message: "Value must be a non-empty string." });
    return undefined;
  }
  return raw.trim();
}

function optionalStringArray(
  raw: unknown,
  field: string,
  issues: ExecutionProfileValidationIssue[]
): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    issues.push({ field, message: "Value must be a list of non-empty strings." });
    return undefined;
  }
  return raw.map((value) => value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
