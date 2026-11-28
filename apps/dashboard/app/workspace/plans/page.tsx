import { PlanPicker } from "../../../components/workspace/plans/plan-picker";

export const metadata = { title: "Plans" };

/** `/workspace/plans`: every Project's Plans in one read-only picker. */
export default function WorkspacePlansPage() {
  return <PlanPicker />;
}
