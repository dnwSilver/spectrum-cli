#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("../src/command-executor", () => ({
  runCommand: jest.fn(),
}));

const { logSuccess, logError } = require("../src/utils");
const { runCommand } = require("../src/command-executor");
const version = require("../src/version");

describe("version", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("upVersion handles major/minor/patch/default", () => {
    expect(version.upVersion("1.2.3", "major")).toBe("2.0.0");
    expect(version.upVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(version.upVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(version.upVersion("1.2.3", "unknown")).toBe("1.2.4");
  });

  test("setVersion delegates to executor", async () => {
    runCommand.mockResolvedValue(true);
    await expect(version.setVersion("minor")).resolves.toBe(true);
    expect(runCommand).toHaveBeenCalled();
  });

  test("setVersion can fail from executor", async () => {
    runCommand.mockResolvedValue(false);
    await expect(version.setVersion("patch")).resolves.toBe(false);
  });

  test("setVersion executes update step and writes new version", async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ version: "1.2.3", name: "x" }));
    fs.writeFileSync.mockImplementation(() => {});
    runCommand.mockImplementation(async (spec) => spec.steps[0].run({}));

    await expect(version.setVersion("minor")).resolves.toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "package.json",
      JSON.stringify({ version: "1.3.0", name: "x" }, null, 2) + "\n"
    );
    expect(logSuccess).toHaveBeenCalledWith("🔖", "Версия обновлена с %s до %s.", "1.2.3", "1.3.0");
  });

  test("setVersion returns false on package read error", async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error("boom"); });
    runCommand.mockImplementation(async (spec) => spec.steps[0].run({}));

    await expect(version.setVersion("patch")).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "Ошибка при обновлении версии в package.json");
  });
});
