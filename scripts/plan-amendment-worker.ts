import { runPlanAmendment } from "../src/operatorActions/planAmendment.js";
const result = runPlanAmendment(process.argv[2]);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = result.status === "succeeded" ? 0 : 1;
