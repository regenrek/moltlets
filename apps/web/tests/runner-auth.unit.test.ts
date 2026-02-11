import { describe, expect, it } from "vitest";
import { isRunnerTokenUsable } from "../convex/controlPlane/httpParsers";

describe("runner auth token validation", () => {
  it("accepts valid non-revoked token bound to runner project", () => {
    expect(
      isRunnerTokenUsable({
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

  it("accepts legacy non-expiring tokens when not revoked", () => {
    expect(
      isRunnerTokenUsable({
        tokenDoc: {
          projectId: "p1",
          runnerId: "r1",
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
      isRunnerTokenUsable({
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
      isRunnerTokenUsable({
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
      isRunnerTokenUsable({
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
      isRunnerTokenUsable({
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
