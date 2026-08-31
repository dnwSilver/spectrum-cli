#!/usr/bin/env node
jest.mock("../src/git", () => ({
  goToDevBranch: jest.fn(),
  goToMainBranch: jest.fn(),
  updateCurrentBranch: jest.fn(),
}));

jest.mock("../src/changelog", () => ({
  changelogBuildRelease: jest.fn(),
  changelogRemoveFragments: jest.fn(),
}));

jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execCommand: jest.fn(),
  execSilent: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
  colors: {},
}));

jest.mock("../src/command-executor", () => ({
  runCommand: jest.fn(),
}));

jest.mock("../src/version", () => ({
  upVersion: jest.fn(),
}));

const git = require("../src/git");
const changelog = require("../src/changelog");
const utils = require("../src/utils");
const version = require("../src/version");
const { runCommand } = require("../src/command-executor");
const release = require("../src/release");

describe("release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    git.goToDevBranch.mockReturnValue(true);
    git.goToMainBranch.mockReturnValue(true);
    git.updateCurrentBranch.mockReturnValue(true);
    changelog.changelogBuildRelease.mockReturnValue(true);
    changelog.changelogRemoveFragments.mockReturnValue(true);
    utils.execCommand.mockReturnValue(true);
    utils.execSilent.mockReturnValue("");
    version.upVersion.mockImplementation((oldVersion, bump) => {
      const [major, minor, patch] = oldVersion.split(".").map(Number);
      if (bump === "major") return `${major + 1}.0.0`;
      if (bump === "minor") return `${major}.${minor + 1}.0`;
      return `${major}.${minor}.${patch + 1}`;
    });
  });

  test("derives the highest SemVer bump from fragment metadata", () => {
    expect(release.detectBumpType([{ bump: "patch" }, { bump: "major" }, { bump: "minor" }])).toBe("major");
    expect(release.detectBumpType([{ bump: "patch" }, { bump: "minor" }])).toBe("minor");
    expect(release.detectBumpType([{ bump: "patch" }])).toBe("patch");
    expect(release.detectBumpType([])).toBe("patch");
  });

  test("resolves release versions from the stable tag baseline", () => {
    expect(release.resolveReleaseVersion("1.1.0", [{ bump: "patch" }])).toEqual({
      bumpType: "patch",
      newVersion: "1.1.1",
    });
    expect(release.resolveReleaseVersion("1.1.0", [{ bump: "fixed" }, { bump: "minor" }])).toEqual({
      bumpType: "minor",
      newVersion: "1.2.0",
    });
    expect(release.resolveReleaseVersion("1.1.0", [{ bump: "major" }])).toEqual({
      bumpType: "major",
      newVersion: "2.0.0",
    });
  });

  test("releasePush publishes the release commit to dev and main atomically", () => {
    utils.getMainBranch.mockReturnValue("main");
    const context = { devBranch: "dev", mainBranch: "main", newVersion: "1.2.3" };

    expect(release.releasePush(context)).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith(
      "git push --atomic origin dev:dev dev:main"
    );
    expect(utils.logSuccess).toHaveBeenCalledWith(
      "📤",
      "Релиз атомарно отправлен в origin/%s и origin/%s.",
      "dev",
      "main"
    );
    expect(git.goToMainBranch).not.toHaveBeenCalled();
  });

  test("releasePush handles push failures and missing branch context", () => {
    utils.getMainBranch.mockReturnValue("main");
    const context = { devBranch: "dev", mainBranch: "main", newVersion: "1.2.3" };

    expect(release.releasePush(context)).toBe(true);

    utils.execCommand.mockReturnValue(false);
    expect(release.releasePush(context)).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith(
      "❌",
      expect.stringContaining("Релиз не отправлен"),
      expect.stringContaining("git push --atomic")
    );
    expect(release.releasePush({})).toBe(false);
  });

  test("releaseStart wires fragment validation, bump, assembly, cleanup, and publication in order", async () => {
    runCommand.mockImplementation(async (spec) => spec);

    const spec = await release.releaseStart();

    expect(spec.checks.map((check) => check.name)).toEqual([
      "git-repo",
      "clean-working-tree",
      "branch-up-to-date",
      "main-and-dev-branches",
      "on-dev-branch",
      "stable-version",
      "changelog-exists",
      "no-pending-release",
      "changelog-prettier-check",
      "changelog-fragments",
      "detect-bump-type",
    ]);
    expect(spec.steps.map((step) => step.name)).toEqual([
      "build-release-changelog",
      "remove-changelog-fragments",
      "format-changelog",
      "lint-changelog",
      "commit-release",
      "push-dev-and-main",
    ]);

    const bumpCheck = spec.checks.find((check) => check.name === "detect-bump-type");
    const bumpResult = bumpCheck.run({
      stableVersion: "1.4.2",
      changelogFragments: [{ bump: "patch" }, { bump: "major" }],
    });
    expect(bumpResult).toEqual({
      ok: true,
      data: {
        bumpType: "major",
        newVersion: "2.0.0",
      },
    });
    expect(version.upVersion).toHaveBeenCalledWith("1.4.2", "major");
  });

  test("releaseStart rejects a version already used by a hotfix branch", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();
    utils.execSilent.mockReturnValueOnce("hotfix/AR-123-1.3.0");

    const bumpCheck = spec.checks.find((check) => check.name === "detect-bump-type");
    expect(bumpCheck.run({
      stableVersion: "1.2.0",
      changelogFragments: [{ bump: "minor" }],
    }).ok).toBe(false);
  });

  test("releaseStart steps collapse fragments and stage only changelog artifacts", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();

    const context = { newVersion: "1.3.0", changelogFragments: [{ filePath: ".changelog/a.added.md" }] };
    expect(spec.steps[0].run(context)).toBe(true);
    expect(changelog.changelogBuildRelease).toHaveBeenCalledWith(context);
    expect(spec.steps[1].run(context)).toBe(true);
    expect(changelog.changelogRemoveFragments).toHaveBeenCalledWith(context);

    utils.execSilent.mockReturnValue("3.0.0");
    expect(spec.steps[2].run(context)).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith(
      "npx --yes prettier --write CHANGELOG.md"
    );

    expect(spec.steps[4].run(context)).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith(
      "git add --all -- CHANGELOG.md .changelog"
    );
    expect(utils.execCommand).toHaveBeenCalledWith(
      'git commit --message "📝 Подготовить релиз 1.3.0." --no-verify'
    );
    expect(utils.execCommand).not.toHaveBeenCalledWith(expect.stringContaining("package.json"));
  });

  test("releaseStart fails format and lint steps cleanly without prettier", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();

    utils.execSilent.mockReturnValue(null);
    expect(spec.steps[2].run({})).toBe(false);
    expect(spec.steps[3].run({})).toBe(false);
  });

  test("releaseClose reads the release version from the changelog heading", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseClose();

    expect(spec.checks.map((check) => check.name)).toEqual([
      "git-repo",
      "clean-working-tree",
      "branch-up-to-date",
      "on-main-branch",
      "main-and-dev-branches",
      "changelog-release-version",
      "stable-tag-at-head",
    ]);
  });

  test("releaseClose only syncs stable into dev and exposes merge and push failures", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseClose();

    utils.getMainBranch.mockReturnValue("main");
    utils.execCommand.mockImplementation((command) => command !== "git merge main");
    expect(spec.steps[4].run({})).toBe(false);

    utils.getCurrentBranch.mockReturnValue("dev");
    utils.execCommand.mockImplementation((command) => command !== "git push origin dev");
    expect(spec.steps[5].run({ devBranch: "dev" })).toBe(false);
    expect(spec.steps.map((step) => step.name)).toEqual([
      "switch-main",
      "update-main",
      "switch-dev",
      "update-dev",
      "merge-main-into-dev",
      "push-dev",
    ]);
  });
});
