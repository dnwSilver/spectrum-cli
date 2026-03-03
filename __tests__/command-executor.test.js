#!/usr/bin/env node
jest.mock("../src/utils", () => ({
  logError: jest.fn(),
  logSuccess: jest.fn(),
}));

const { logError, logSuccess } = require("../src/utils");
const { runCommand } = require("../src/command-executor");

describe("command-executor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("fails fast on preflight and skips steps", async () => {
    const step = jest.fn();
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => ({ ok: false, reason: "boom" }) }],
      steps: [{ name: "step", run: step }],
    });

    expect(result).toBe(false);
    expect(step).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  test("runs all steps when checks pass", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => true }],
      steps: [{ name: "s1", run: () => true }, { name: "s2", run: () => true }],
    });

    expect(result).toBe(true);
    expect(logSuccess).toHaveBeenCalledWith("✅", "[%s] Completed.", "demo");
  });

  test("stops on failed step", async () => {
    const second = jest.fn();
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => true }],
      steps: [{ name: "s1", run: () => false }, { name: "s2", run: second }],
    });

    expect(result).toBe(false);
    expect(second).not.toHaveBeenCalled();
  });
});
