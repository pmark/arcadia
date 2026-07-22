import type {
  IntelligenceResourceGroup,
} from "../config/types.js";
import type { ResolvedIntelligenceRoute } from "../routing/resolveRoute.js";

/** Maps a deterministic route to the physical resource it competes for. */
export function resolveIntelligenceResourceGroup(
  route: ResolvedIntelligenceRoute,
): IntelligenceResourceGroup {
  if (route.executor === "codex-cli") return "codex-cli";
  if (route.executor === "comfyui") return "comfyui";
  if (route.executor === "speech") {
    return route.location === "local" ? "speech-local" : "speech-cloud";
  }
  if (route.location === "local") return "litellm-local";
  return route.capability.startsWith("image.")
    ? "litellm-cloud-image"
    : "litellm-cloud-text";
}
