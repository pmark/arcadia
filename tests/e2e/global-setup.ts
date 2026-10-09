import path from "node:path";
import { staleBuiltCliMessage } from "./fixtures/builtCliGuard.js";

/** Refuse to run e2e against a missing or stale `dist` (#1106). */
export default function globalSetup(): void {
  const message = staleBuiltCliMessage(path.resolve(import.meta.dirname, "../.."));
  if (message) throw new Error(message);
}
