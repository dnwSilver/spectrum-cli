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
  getMergeRequestUrl: jest.fn(),
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

  test("releasePush success with MR url", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.getMainBranch.mockReturnValue("main");
    utils.getMergeRequestUrl.mockReturnValue(
      "https://gitlab.spectrumdata.tech/group/project/-/merge_requests/new?merge_request[source_branch]=release%2F1.2.3&merge_request[target_branch]=main"
    );

    expect(release.releasePush()).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git push origin release/1.2.3");
    expect(utils.getMergeRequestUrl).toHaveBeenCalledWith("release/1.2.3", "main");
    expect(utils.logSuccess).toHaveBeenCalledWith(
      "🌐",
      "Create Merge Request: %s",
      "https://gitlab.spectrumdata.tech/group/project/-/merge_requests/new?merge_request[source_branch]=release%2F1.2.3&merge_request[target_branch]=main"
    );
    expect(git.goToMainBranch).toHaveBeenCalled();
  });

  test("releasePush success without MR url", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.getMainBranch.mockReturnValue("main");
    utils.getMergeRequestUrl.mockReturnValue(null);

    expect(release.releasePush()).toBe(true);
    expect(utils.logSuccess).not.toHaveBeenCalledWith("🌐", expect.any(String), expect.any(String));
    expect(git.goToMainBranch).toHaveBeenCalled();
  });

  test("releasePush fail", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.execCommand.mockReturnValue(false);

    expect(release.releasePush()).toBe(false);
    expect(utils.logSuccess).not.toHaveBeenCalledWith("🌐", expect.any(String), expect.any(String));
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
