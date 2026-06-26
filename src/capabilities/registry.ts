import type { CapabilityModule } from "./core.js";
import { bloggingModule } from "./blogging/module.js";
import { rebusterModule } from "./rebuster/module.js";

export const builtInCapabilityModules: CapabilityModule[] = [bloggingModule, rebusterModule];

export function listCapabilities(): CapabilityModule[] {
  return builtInCapabilityModules;
}

export function getCapability(id: string): CapabilityModule | null {
  return builtInCapabilityModules.find((module) => module.id === id) ?? null;
}
