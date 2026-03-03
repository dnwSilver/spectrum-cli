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
  execSilent: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getMergeRequestUrl: jest.fn(),
  colors: {},
}));
jest.mock("../src/command-executor", () => ({
  runCommand: jest.fn(),
}));

const git = require("../src/git");
const changelog = require("../src/changelog");
const utils = require("../src/utils");
const { runCommand } = require("../src/command-executor");
const release = require("../src/release");

describe("release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    git.goToDevBranch.mockReturnValue(true);
    git.goToMainBranch.mockReturnValue(true);
    git.updateCurrentBranch.mockReturnValue(true);
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

  test("releaseCreate fails when goToDevBranch fails", () => {
    git.goToDevBranch.mockReturnValue(false);
    expect(release.releaseCreate()).toBe(false);
  });

  test("releaseCreate fails when updateCurrentBranch fails", () => {
    git.updateCurrentBranch.mockReturnValue(false);
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

  test("releaseClose delegates to executor", async () => {
    runCommand.mockResolvedValue(true);
    await expect(release.releaseClose()).resolves.toBe(true);
    expect(runCommand).toHaveBeenCalled();
  });

  test("releaseStart delegates to executor", async () => {
    runCommand.mockResolvedValue(false);
    await expect(release.releaseStart()).resolves.toBe(false);
    expect(runCommand).toHaveBeenCalled();
  });

  test("releaseClose merge step failure", async () => {
    utils.getMainBranch.mockReturnValue("main");
    utils.execCommand.mockImplementation((cmd) => cmd !== "git merge main");
    runCommand.mockImplementation(async (spec) => spec.steps[4].run({}));

    await expect(release.releaseClose()).resolves.toBe(false);
  });

  test("releaseClose push step failure", async () => {
    utils.getCurrentBranch.mockReturnValue("dev");
    utils.execCommand.mockImplementation((cmd) => cmd !== "git push origin dev -o ci.skip");
    runCommand.mockImplementation(async (spec) => spec.steps[5].run({}));

    await expect(release.releaseClose()).resolves.toBe(false);
  });

  test("releaseStart lint-changelog step covers failed preflight", async () => {
    const preflight = require("../src/preflight");
    jest.spyOn(preflight, "requireChangelogFormatted").mockReturnValue({ ok: false, reason: "bad format" });
    runCommand.mockImplementation(async (spec) => spec.steps[3].run({}));

    await expect(release.releaseStart()).resolves.toBe(false);
    preflight.requireChangelogFormatted.mockRestore();
  });
});
