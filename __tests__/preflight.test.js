#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../src/utils", () => ({
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
  getVersion: jest.fn(),
}));

const utils = require("../src/utils");
const preflight = require("../src/preflight");

describe("preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requireGitRepo", () => {
    utils.execCommand.mockReturnValue(true);
    expect(preflight.requireGitRepo().ok).toBe(true);

    utils.execCommand.mockReturnValue(false);
    expect(preflight.requireGitRepo().ok).toBe(false);
  });

  test("requireCleanWorkingTree", () => {
    utils.execSilent.mockReturnValue("");
    expect(preflight.requireCleanWorkingTree().ok).toBe(true);

    utils.execSilent.mockReturnValue(" M package.json");
    expect(preflight.requireCleanWorkingTree().ok).toBe(false);
  });

  test("requirePackageVersion", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    expect(preflight.requirePackageVersion()).toEqual({ ok: true, data: { version: "1.2.3" } });

    utils.getVersion.mockReturnValue("latest");
    expect(preflight.requirePackageVersion().ok).toBe(false);
  });

  test("requireTagMissing", () => {
    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("");
    expect(preflight.requireTagMissing("v1.2.3").ok).toBe(true);

    utils.execSilent.mockReturnValueOnce("v1.2.3");
    expect(preflight.requireTagMissing("v1.2.3").ok).toBe(false);
  });

  test("requireSingleChart", () => {
    fs.existsSync.mockImplementation((p) => p === "charts" || p === "charts/app/Chart.yaml");
    fs.readdirSync.mockReturnValue([{ name: "app", isDirectory: () => true }]);
    fs.readFileSync.mockReturnValue("name: app\n");

    expect(preflight.requireSingleChart()).toEqual({
      ok: true,
      data: { chartFilePath: "charts/app/Chart.yaml", chartName: "app" },
    });
  });
});
