import { describe, expect, it } from "vitest";
import { __test_isRunnerTokenUsable } from "../convex/http";

describe("runner auth token validation", () => {
  it("accepts valid non-revoked token bound to runner project", () => {
    expect(
      __test_isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
          expiresAt: 200,
        },
        runner: {
          projectId: "p1",
          runnerName: "runner-a",
        },
        expectedProjectId: "p1",
        now: 100,
      }),
    ).toBe(true);
  });

  it("rejects expired or revoked tokens", () => {
    expect(
      __test_isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
          expiresAt: 100,
        },
        runner: {
          projectId: "p1",
          runnerName: "runner-a",
        },
        expectedProjectId: "p1",
        now: 100,
      }),
    ).toBe(false);
    expect(
      __test_isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
          expiresAt: 200,
          revokedAt: 50,
        },
        runner: {
          projectId: "p1",
          runnerName: "runner-a",
        },
        expectedProjectId: "p1",
        now: 100,
      }),
    ).toBe(false);
  });

  it("rejects runner/project mismatches", () => {
    expect(
      __test_isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
          expiresAt: 200,
        },
        runner: {
          projectId: "p2",
          runnerName: "runner-a",
        },
        expectedProjectId: "p1",
        now: 100,
      }),
    ).toBe(false);
    expect(
      __test_isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
          expiresAt: 200,
        },
        runner: {
          projectId: "p1",
          runnerName: "runner-a",
        },
        expectedProjectId: "p2",
        now: 100,
      }),
    ).toBe(false);
  });
});
