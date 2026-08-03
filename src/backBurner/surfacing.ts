import type Database from "better-sqlite3";
import type {
  BackBurnerItem,
  BackBurnerSurfaceCondition
} from "../domain/types.js";
import type { WorkItemStatus } from "../domain/constants.js";
import { localDateStamp } from "../utils/time.js";

export interface SurfaceEvaluation {
  condition: BackBurnerSurfaceCondition;
  fired: boolean;
  warning: string | null;
}

interface PredicateContext {
  db: Database.Database;
  item: BackBurnerItem;
}

type SurfacePredicate = (context: PredicateContext) => boolean;

/**
 * Closed, code-reviewed predicate registry. Add named deterministic checks
 * here; Back Burner rows store identifiers, never executable expressions.
 */
export const BACK_BURNER_SURFACE_PREDICATES: Readonly<Record<string, SurfacePredicate>> = {
  "project-has-three-open-actions": ({ db, item }) => {
    if (!item.project_id) return false;
    const row = db.prepare(
      "SELECT COUNT(*) AS count FROM work_items WHERE project_id = ? AND status IN ('open', 'in_progress')"
    ).get(item.project_id) as { count: number };
    return row.count >= 3;
  }
};

export function evaluateBackBurnerSurface(
  db: Database.Database,
  item: BackBurnerItem,
  now = new Date()
): SurfaceEvaluation {
  const condition = conditionFromItem(item);
  switch (condition.kind) {
    case "manual":
      return { condition, fired: false, warning: null };
    case "date": {
      if (!isValidSurfaceDate(condition.date)) {
        return { condition, fired: false, warning: `Invalid surface date: ${condition.date}` };
      }
      return { condition, fired: localDateStamp(now) >= condition.date, warning: null };
    }
    case "dependency": {
      const dependency = db.prepare("SELECT status FROM work_items WHERE id = ?").get(condition.workItemId) as
        | { status: WorkItemStatus }
        | undefined;
      if (!dependency) {
        return {
          condition,
          fired: false,
          warning: `Surface dependency Action was not found: ${condition.workItemId}`
        };
      }
      return { condition, fired: dependency.status === condition.status, warning: null };
    }
    case "predicate": {
      const predicate = BACK_BURNER_SURFACE_PREDICATES[condition.name];
      if (!predicate) {
        return {
          condition,
          fired: false,
          warning: `Unknown surface predicate: ${condition.name}`
        };
      }
      return { condition, fired: predicate({ db, item }), warning: null };
    }
  }
}

export function isValidSurfaceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function conditionFromItem(item: BackBurnerItem): BackBurnerSurfaceCondition {
  switch (item.surface_kind) {
    case "date":
      return { kind: "date", date: item.surface_date ?? "" };
    case "dependency":
      return {
        kind: "dependency",
        workItemId: item.surface_dependency_work_item_id ?? "",
        status: item.surface_dependency_status ?? "done"
      };
    case "predicate":
      return { kind: "predicate", name: item.surface_predicate ?? "" };
    case "manual":
    case null:
      return { kind: "manual" };
  }
}
