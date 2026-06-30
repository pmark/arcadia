import type {
  ExecutionPreference,
  IntelligenceCapability,
  IntelligenceJob,
  IntelligenceProfile,
} from "@pmark/arcadia/intelligence/contracts";

/** One entry from GET /api/intelligence/health, as shaped for the admin UI. */
export interface IntelligenceOffering {
  id: string;
  capability: IntelligenceCapability;
  location: "local" | "cloud";
  profile: IntelligenceProfile;
  executor: "litellm" | "codex-cli";
  requiresPaidUsage: boolean;
}

export interface IntelligenceCapabilitiesResponse {
  reachable: boolean;
  liteLlmBaseUrl: string;
  liteLlmReachable: boolean;
  textOfferings: IntelligenceOffering[];
  imageOfferings: IntelligenceOffering[];
  error?: string;
}

export type AdminOutputMode = "plain" | "structured";

export interface AdminTextSubmission {
  capability: "text.generate";
  offeringId: string;
  execution: ExecutionPreference;
  profile: IntelligenceProfile;
  prompt: string;
  outputMode: AdminOutputMode;
  presetId?: string;
  label?: string;
  allowPaidUsage: boolean;
}

export interface AdminImageSubmission {
  capability: "image.generate";
  offeringId: string;
  execution: ExecutionPreference;
  profile: IntelligenceProfile;
  prompt: string;
  count: number;
  label?: string;
  allowPaidUsage: boolean;
}

export type AdminSubmission = AdminTextSubmission | AdminImageSubmission;

export interface AdminJobSummary {
  job: IntelligenceJob;
}

/** clientApp value Arcadia stores on every job submitted from this page. */
export const ADMIN_INTELLIGENCE_CLIENT_APP = "arcadia-admin";
