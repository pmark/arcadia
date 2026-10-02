import { requestContainerAudit } from "../src/sessions/containerAuditTransport.js";
if (process.argv.length !== 2) throw new Error("The fixed browser-audit request accepts no arguments");
process.stdout.write(`${JSON.stringify(await requestContainerAudit(), null, 2)}\n`);
