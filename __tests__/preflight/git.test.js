#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../../src/common/utils", () => ({
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
}));

const utils = require("../../src/common/utils");
const preflight = require("../../src/preflight");

function normalizePath(p) {
  return String(p).replace(/\\/g, "/");
}

describe("preflight git", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.getMainBranch.mockReturnValue("main");
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

  test("requireRemoteOrigin", () => {
    utils.execSilent.mockReturnValue("git@github.com:org/repo.git");
    expect(preflight.requireRemoteOrigin().ok).toBe(true);

    utils.execSilent.mockReturnValue("");
    expect(preflight.requireRemoteOrigin().ok).toBe(false);
  });

  test("requireRemoteReachable", () => {
    utils.execSilent.mockReturnValue("abcd\trefs/heads/main");
    expect(preflight.requireRemoteReachable().ok).toBe(true);

    utils.execSilent.mockReturnValue(null);
    expect(preflight.requireRemoteReachable().ok).toBe(false);
  });

  test("requireCurrentBranchUpToDateWithRemote", () => {
    utils.getCurrentBranch.mockReturnValue("feature/x");
    utils.execCommand.mockReturnValue(true);
    utils.execSilent
      .mockReturnValueOnce("origin/feature/x")
      .mockReturnValueOnce("3 0");
    expect(preflight.requireCurrentBranchUpToDateWithRemote().ok).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git fetch origin --prune --tags");

    utils.execCommand.mockReturnValue(false);
    expect(preflight.requireCurrentBranchUpToDateWithRemote().ok).toBe(false);

    utils.execCommand.mockReturnValue(true);
    utils.execSilent.mockReturnValueOnce(null);
    expect(preflight.requireCurrentBranchUpToDateWithRemote().ok).toBe(false);

    utils.execSilent
      .mockReturnValueOnce("origin/feature/x")
      .mockReturnValueOnce("1 2");
    expect(preflight.requireCurrentBranchUpToDateWithRemote().ok).toBe(false);
  });

  test("requireDevContainsRemoteMain", () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.execCommand.mockReturnValue(true);
    expect(preflight.requireDevContainsRemoteMain()).toEqual({
      ok: true,
      data: { remoteMain: "origin/main" },
    });
    expect(utils.execCommand).toHaveBeenCalledWith("git merge-base --is-ancestor origin/main HEAD");

    utils.getMainBranch.mockReturnValue("master");
    utils.execCommand.mockReturnValue(false);
    const failed = preflight.requireDevContainsRemoteMain();
    expect(failed.ok).toBe(false);
    expect(failed.reason).toContain("origin/master");
  });

  test("requireMainAndDevBranches validates remotes", () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.getDevelopBranch.mockReturnValue("develop");
    utils.execSilent.mockReturnValue("origin/main\norigin/develop");
    expect(preflight.requireMainAndDevBranches().ok).toBe(true);

    utils.execSilent.mockReturnValue("origin/main");
    expect(preflight.requireMainAndDevBranches().ok).toBe(false);

    utils.execSilent.mockReturnValue(null);
    expect(preflight.requireMainAndDevBranches().ok).toBe(false);
  });

  test("requireCurrentBranch and requireOnMainBranch", () => {
    utils.getCurrentBranch.mockReturnValue("feature/a");
    expect(preflight.requireCurrentBranch("feature/a").ok).toBe(true);
    expect(preflight.requireCurrentBranch("main").ok).toBe(false);

    utils.getMainBranch.mockReturnValue("main");
    expect(preflight.requireOnMainBranch().ok).toBe(false);

    utils.getCurrentBranch.mockReturnValue("main");
    expect(preflight.requireOnMainBranch().ok).toBe(true);
  });

});
