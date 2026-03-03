#!/usr/bin/env node
jest.mock("../src/git", () => ({
  goToDevBranch: jest.fn(),
  goToMainBranch: jest.fn(),
  updateCurrentBranch: jest.fn(),
}));

jest.mock("../src/changelog", () => ({
  changelogChangeHeader: jest.fn(),
  changelogRemoveEmptyChapters: jest.fn(),
  changelogAddUnreleasedBlock: jest.fn(),
  changelogCommit: jest.fn(),
}));

jest.mock("../src/utils", () => ({
  getVersion: jest.fn(),
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  colors: {},
}));

const git = require("../src/git");
const changelog = require("../src/changelog");
const utils = require("../src/utils");
const release = require("../src/release");

describe("release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    changelog.changelogChangeHeader.mockReturnValue(true);
    changelog.changelogRemoveEmptyChapters.mockReturnValue(true);
    changelog.changelogAddUnreleasedBlock.mockReturnValue(true);
    changelog.changelogCommit.mockReturnValue(true);
    utils.execCommand.mockReturnValue(true);
  });

  test("releaseCreate fails when version missing", () => {
    utils.getVersion.mockReturnValue(null);

    expect(release.releaseCreate()).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("❌", "Cannot get version from package.json");
  });

  test("releaseCreate success", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");

    expect(release.releaseCreate()).toBe(true);
    expect(git.goToDevBranch).toHaveBeenCalled();
    expect(git.updateCurrentBranch).toHaveBeenCalled();
    expect(utils.execCommand).toHaveBeenCalledWith("git switch -c release/1.2.3");
  });

  test("releaseCreate fails when switch fails", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    utils.execCommand.mockReturnValue(false);

    expect(release.releaseCreate()).toBe(false);
  });

  test("releasePush success", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");

    expect(release.releasePush()).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git push origin release/1.2.3");
    expect(git.goToMainBranch).toHaveBeenCalled();
  });

  test("releasePush fail", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.execCommand.mockReturnValue(false);

    expect(release.releasePush()).toBe(false);
  });

  test("releaseClose success", () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.getCurrentBranch.mockReturnValue("dev");
    utils.execCommand.mockReturnValue(true);

    expect(release.releaseClose()).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git merge main");
    expect(utils.execCommand).toHaveBeenCalledWith("git push origin dev -o ci.skip");
  });

  test("releaseClose fail at merge", () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.execCommand.mockReturnValueOnce(false);

    expect(release.releaseClose()).toBe(false);
  });

  test("releaseClose fail at push", () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.getCurrentBranch.mockReturnValue("dev");
    utils.execCommand.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(release.releaseClose()).toBe(false);
  });

  test("releaseStart success", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.execCommand.mockReturnValue(true);

    expect(release.releaseStart()).toBe(true);
    expect(utils.logSuccess).toHaveBeenCalledWith("🚀", "Release started successfully!");
  });

  test("releaseStart fails on first failed step", () => {
    utils.getVersion.mockReturnValue(null);

    expect(release.releaseStart()).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("✖", "Failed at step: %s", "Create release branch");
  });
});
