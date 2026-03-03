#!/usr/bin/env node
jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
  getVersion: jest.fn(),
}));
jest.mock("../src/command-executor", () => ({
  runCommand: jest.fn(),
}));

const {
  logSuccess,
  logError,
  execSilent,
  execCommand,
  getCurrentBranch,
  getMainBranch,
  getDevelopBranch,
  getVersion,
} = require("../src/utils");
const { runCommand } = require("../src/command-executor");
const git = require("../src/git");

describe("git", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("goToMainBranch success", () => {
    getMainBranch.mockReturnValue("main");
    execCommand.mockReturnValue(true);

    expect(git.goToMainBranch()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("git switch main");
    expect(logSuccess).toHaveBeenCalledWith("🌿", "Swap to branch %s.", "main");
  });

  test("goToMainBranch fail", () => {
    getMainBranch.mockReturnValue("main");
    execCommand.mockReturnValue(false);

    expect(git.goToMainBranch()).toBe(false);
  });

  test("goToDevBranch success", () => {
    getDevelopBranch.mockReturnValue("dev");
    getCurrentBranch.mockReturnValue("dev");
    execCommand.mockReturnValue(true);

    expect(git.goToDevBranch()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("git switch dev");
    expect(logSuccess).toHaveBeenCalledWith("🌿", "Swap to branch %s.", "dev");
  });

  test("goToDevBranch fail", () => {
    getDevelopBranch.mockReturnValue("dev");
    execCommand.mockReturnValue(false);

    expect(git.goToDevBranch()).toBe(false);
  });

  test("updateCurrentBranch success", () => {
    getCurrentBranch.mockReturnValue("feature/X-1");
    execCommand.mockReturnValue(true);

    expect(git.updateCurrentBranch()).toBe(true);
    expect(execCommand).toHaveBeenNthCalledWith(1, "git pull origin feature/X-1");
    expect(execCommand).toHaveBeenNthCalledWith(2, "git fetch --all --prune --jobs=10");
  });

  test("updateCurrentBranch fail", () => {
    getCurrentBranch.mockReturnValue("feature/X-1");
    execCommand.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(git.updateCurrentBranch()).toBe(false);
  });

  test("gitMergeOriginDev success", () => {
    getDevelopBranch.mockReturnValue("dev");
    getCurrentBranch.mockReturnValue("feature/X-1");
    execCommand.mockReturnValue(true);

    expect(git.gitMergeOriginDev()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("git merge origin/dev");
  });

  test("gitMergeOriginDev fail on switch back", () => {
    getDevelopBranch.mockReturnValue("dev");
    getCurrentBranch.mockReturnValue("feature/X-1");
    execCommand
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(git.gitMergeOriginDev()).toBe(false);
  });

  test("gitLfsReset success", () => {
    execCommand.mockReturnValue(true);

    expect(git.gitLfsReset()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("git lfs uninstall");
    expect(execCommand).toHaveBeenCalledWith("git reset --hard");
    expect(execCommand).toHaveBeenCalledWith("git lfs install");
    expect(execCommand).toHaveBeenCalledWith("git lfs pull");
    expect(execCommand).toHaveBeenCalledWith("rm .gitattributes");
    expect(execCommand).toHaveBeenCalledWith("git restore .gitattributes");
  });

  test("gitLfsReset fail", () => {
    execCommand.mockReturnValueOnce(false);

    expect(git.gitLfsReset()).toBe(false);
    expect(execCommand).not.toHaveBeenCalledWith("rm .gitattributes");
  });

  test("gitCreateTagAndPush delegates to executor", async () => {
    runCommand.mockResolvedValue(true);
    await expect(git.gitCreateTagAndPush()).resolves.toBe(true);
    expect(runCommand).toHaveBeenCalled();
  });
});
