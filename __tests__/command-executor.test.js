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

  test("fails when command name is missing", async () => {
    const result = await runCommand({});
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "Command name is required.");
  });

  test("fails when command spec is undefined", async () => {
    const result = await runCommand();
    expect(result).toBe(false);
  });

  test("normalizes string preflight result reason", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => "custom reason" }],
      steps: [{ name: "s1", run: () => true }],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "[%s] Preflight failed (%s): %s", "demo", "a", "custom reason");
  });

  test("normalizes object preflight result with data merge", async () => {
    const seen = [];
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => ({ ok: true, data: { v: 1 } }) }],
      steps: [{ name: "s1", run: (ctx) => { seen.push(ctx.v); return true; } }],
    });
    expect(result).toBe(true);
    expect(seen).toEqual([1]);
  });

  test("normalizes invalid preflight payload", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => 123 }],
      steps: [],
    });
    expect(result).toBe(false);
  });

  test("uses fallback names for missing check and step names", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ run: () => true }],
      steps: [{ run: () => true }],
    });
    expect(result).toBe(true);
    expect(logSuccess).toHaveBeenCalledWith("✅", "[%s] Completed.", "demo");
  });

  test("uses fallback reason for boolean false preflight", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "strict-check", run: () => false }],
      steps: [],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "❌",
      "[%s] Preflight failed (%s): %s",
      "demo",
      "strict-check",
      "Check failed: strict-check"
    );
  });

  test("uses normalized fallback reason when preflight reason is missing", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "strict-check", run: () => ({ ok: false }) }],
      steps: [],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "❌",
      "[%s] Preflight failed (%s): %s",
      "demo",
      "strict-check",
      "Check failed: strict-check"
    );
  });
});
