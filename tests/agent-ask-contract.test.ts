import { describe, expect, it } from "vitest";
import {
  ACTION_ID_MAX_LENGTH,
  AGENT_ASK_INTENTS,
  STRICT_ACTION_FIELDS,
  STRICT_FIELDS,
  STRICT_OPTION_FIELDS
} from "../src/ask/agentAsk.js";
import { renderAgentAskContractSuccess, runAgentAskContractCommand } from "../src/commands/agentAsk.js";

describe("agent-ask contract", () => {
  // The adopted AGENTS.md region carries a prose copy of this contract, and a
  // copy can go stale. The command is only worth trusting if it cannot
  // describe an intent or field the parser does not accept.
  it("reports exactly what the parser accepts", () => {
    const response = runAgentAskContractCommand();
    expect(response.data.intents).toEqual(AGENT_ASK_INTENTS);
    expect(response.data.fields.envelope).toEqual([...STRICT_FIELDS].sort());
    expect(response.data.fields.action).toEqual([...STRICT_ACTION_FIELDS].sort());
    expect(response.data.fields.option).toEqual([...STRICT_OPTION_FIELDS].sort());
    expect(response.data.fields.envelope).toContain("options");
    expect(response.data.actionId.maxLength).toBe(ACTION_ID_MAX_LENGTH);
    expect(response.data.fields.required).toEqual(["request_id", "desired_result"]);
  });

  it("is a noun: no workspace, no Project, and nothing written", () => {
    const response = runAgentAskContractCommand();
    expect(response.ok).toBe(true);
    expect(response.workspace).toBeUndefined();
    expect(response.artifacts).toEqual([]);
    expect(response.command).toBe("agent-ask.contract");
  });

  it("states the authority boundary in rendered output", () => {
    const rendered = renderAgentAskContractSuccess(runAgentAskContractCommand()).join("\n");
    expect(rendered).toContain("never self-approving");
    expect(rendered).toContain("propose | apply_if_approved");
    for (const intent of AGENT_ASK_INTENTS) expect(rendered).toContain(intent);
  });
});
