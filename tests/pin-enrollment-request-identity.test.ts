import { describe, expect, it } from "vitest";

import {
  resolveEnrollmentRequestIdentity,
  resolveEnrollmentRequestMode
} from "../src/sessions/enrollmentRequestProtocol.js";

const IDENTITY_UNAVAILABLE = "Protected enrollment requires stable host-observable request and caller identities.";

describe("resolveEnrollmentRequestIdentity", () => {
  it.each([
    ["claude", { CLAUDE_SESSION_ID: "abcd1234" }, { requestId: "enroll:claude:abcd1234", callerId: "claude:abcd1234" }],
    ["codex", { CODEX_THREAD_ID: "thread-77" }, { requestId: "enroll:codex:thread-77", callerId: "codex:thread-77" }],
    ["opencode", { ARCADIA_ENROLLMENT_RUNTIME_ID: "rt-000001", OPENCODE_SESSION_ID: "ignored1" },
      { requestId: "enroll:opencode:rt-000001", callerId: "opencode:rt-000001" }],
    ["claude", { ARCADIA_ENROLLMENT_REQUEST_ID: "request-0001", ARCADIA_ENROLLMENT_CALLER_ID: "caller-0001" },
      { requestId: "request-0001", callerId: "caller-0001" }]
  ] as const)("resolves %s from %j", (agent, env, expected) => {
    expect(resolveEnrollmentRequestIdentity(agent, { ...env })).toEqual(expected);
  });

  it.each([
    ["claude", {}],
    ["claude", { CODEX_SESSION_ID: "abcd1234" }],
    ["codex", { ARCADIA_ENROLLMENT_REQUEST_ID: "request-0001", ARCADIA_ENROLLMENT_CALLER_ID: "short" }],
    ["codex", { CODEX_SESSION_ID: "has space" }]
  ] as const)("refuses %s with %j", (agent, env) => {
    expect(() => resolveEnrollmentRequestIdentity(agent, { ...env })).toThrow(IDENTITY_UNAVAILABLE);
  });
});

describe("resolveEnrollmentRequestMode", () => {
  it.each([
    [{}, "prepare"],
    [{ ARCADIA_ENROLLMENT_MODE: "   " }, "prepare"],
    [{ ARCADIA_ENROLLMENT_MODE: " managed-launch " }, "managed-launch"],
    [{ ARCADIA_ENROLLMENT_MODE: "native-adopt" }, "native-adopt"]
  ] as const)("reads %j as %s", (env, expected) => {
    expect(resolveEnrollmentRequestMode({ ...env })).toBe(expected);
  });

  it("refuses an unknown mode", () => {
    expect(() => resolveEnrollmentRequestMode({ ARCADIA_ENROLLMENT_MODE: "launch" })).toThrow("Unknown enrollment mode.");
  });
});
