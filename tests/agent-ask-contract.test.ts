import { describe, expect, it } from "vitest";
import {
  ACTION_ID_MAX_LENGTH,
  AGENT_ASK_INTENTS,
  STRICT_ACTION_FIELDS,
  STRICT_FIELDS,
  STRICT_OPTION_FIELDS,
  normalizeAgentAsk
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
    expect(rendered).toContain("Preview records a capture and proposal receipt in the workspace database");
    for (const intent of AGENT_ASK_INTENTS) expect(rendered).toContain(intent);
  });

  it("carries a complete example built only from real envelope fields, so an agent never hunts for one", () => {
    const { data } = runAgentAskContractCommand();
    for (const key of Object.keys(data.completeExample)) expect(data.fields.envelope).toContain(key);
    expect(data.completeExample.intent).toBe("complete");
    const rendered = renderAgentAskContractSuccess(runAgentAskContractCommand()).join("\n");
    expect(rendered).toContain('"candidate_revision"');
    expect(rendered).toContain('"evidence"');
  });
});

describe("agent-ask reference intake", () => {
  // A reference naming one machine's filesystem rots when the file moves, so
  // intake refuses it instead of writing it into a Plan Action.
  const askWith = (references: string) => `agent_ask: v1\nrequest_id: reference-intake\nproject: arcadia\nintent: proposal\ndesired_result: Record references.\nreferences:\n${references}\n`;

  it("accepts URLs, repository-relative paths and governed ids", () => {
    const normalized = normalizeAgentAsk({ request: askWith("  - https://github.com/pmark/arcadia/issues/1032\n  - docs/working-copy-safety.md\n  - decision/0091") });
    expect(normalized.references).toEqual(["https://github.com/pmark/arcadia/issues/1032", "docs/working-copy-safety.md", "decision/0091"]);
  });

  it("refuses absolute and home-relative filesystem paths at the Ask level", () => {
    expect(() => normalizeAgentAsk({ request: askWith("  - /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/bundle/") })).toThrow(/must not contain absolute filesystem paths/);
    expect(() => normalizeAgentAsk({ request: askWith("  - ~/Dev/notes.md") })).toThrow(/must not contain absolute filesystem paths/);
    expect(() => normalizeAgentAsk({ request: askWith("  - ~alice/notes.md") })).toThrow(/must not contain absolute filesystem paths/);
    expect(() => normalizeAgentAsk({ request: askWith("  - C:\\\\Users\\\\pmark\\\\notes.md") })).toThrow(/must not contain absolute filesystem paths/);
  });

  it("refuses absolute filesystem paths on an Action", () => {
    const request = "agent_ask: v1\nrequest_id: reference-intake-action\nproject: arcadia\nintent: plan\ndesired_result: Record references.\nactions:\n  - id: record-evidence\n    desired_result: Record the evidence.\n    acceptance:\n      - Evidence is recorded.\n    references:\n      - /private/tmp/run8-ci-preservation-handoff/manifest.json\n";
    expect(() => normalizeAgentAsk({ request })).toThrow(/actions\[0\]\.references must not contain absolute filesystem paths/);
    expect(() => normalizeAgentAsk({ request: request.replace("/private/tmp/run8-ci-preservation-handoff/manifest.json", "~/Dev/notes.md") })).toThrow(/actions\[0\]\.references must not contain absolute filesystem paths/);
  });
});
