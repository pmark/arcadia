import { describe, expect, it } from "vitest";

import { setTopLevelAskScalar } from "../src/ask/agentAsk.js";

describe("setTopLevelAskScalar", () => {
  it("rewrites request_id in a compact JSON draft", () => {
    const draft = '{"agent_ask":"v1","request_id":"old","project":"arcadia"}';
    expect(setTopLevelAskScalar(draft, "request_id", "new")).toBe('{"agent_ask":"v1","request_id":"new","project":"arcadia"}\n');
  });

  it("appends candidate_revision as the last key of a JSON draft", () => {
    const draft = '{"agent_ask":"v1","project":"arcadia"}';
    expect(setTopLevelAskScalar(draft, "candidate_revision", "abc123")).toBe('{"agent_ask":"v1","project":"arcadia","candidate_revision":"abc123"}\n');
  });

  it("changes only the request_id line of a block YAML draft", () => {
    const draft = "agent_ask: v1\nrequest_id: old\nproject: arcadia\n";
    expect(setTopLevelAskScalar(draft, "request_id", "new")).toBe("agent_ask: v1\nrequest_id: new\nproject: arcadia\n");
  });

  it("returns a block YAML draft without candidate_revision unchanged", () => {
    const draft = "agent_ask: v1\nrequest_id: old\nproject: arcadia\n";
    expect(setTopLevelAskScalar(draft, "candidate_revision", "abc123")).toBe(draft);
  });

  it("returns a JSON array draft unchanged", () => {
    expect(setTopLevelAskScalar("[1,2]", "request_id", "new")).toBe("[1,2]");
  });
});
