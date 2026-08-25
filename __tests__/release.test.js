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
  getVersion: jest.fn(),
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execCommand: jest.fn(),
  execSilent: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getMergeRequestUrl: jest.fn(),
  getPackageManager: jest.fn(),
  colors: {},
}));

jest.mock("../src/command-executor", () => ({
  runCommand: jest.fn(),
}));

jest.mock("../src/version", () => ({
  upVersion: jest.fn(),
  compareVersions: jest.fn(),
  updateVersionFileExact: jest.fn(),
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
    utils.getPackageManager.mockReturnValue("npm");
    version.upVersion.mockImplementation((oldVersion, bump) => {
      const [major, minor, patch] = oldVersion.split(".").map(Number);
      if (bump === "major") return `${major + 1}.0.0`;
      if (bump === "minor") return `${major}.${minor + 1}.0`;
      return `${major}.${minor}.${patch + 1}`;
    });
    version.compareVersions.mockImplementation((left, right) => {
      const a = left.split(".").map(Number);
      const b = right.split(".").map(Number);
      for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
      }
      return 0;
    });
    version.updateVersionFileExact.mockReturnValue(true);
  });

  test("releaseCreate fails when the resolved branch is missing", () => {
    expect(release.releaseCreate({})).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("❌", "Не удалось определить имя release-ветки.");
  });

  test("releaseCreate creates the versioned release branch", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");

    expect(release.releaseCreate({ releaseBranch: "release/1.2.3" })).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git switch -c release/1.2.3");
  });

  test("releaseCreate stops on git failures", () => {
    utils.execCommand.mockReturnValue(false);
    expect(release.releaseCreate({ releaseBranch: "release/1.2.3" })).toBe(false);
  });

  test("releasePush publishes the branch and prints an MR URL", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.getMainBranch.mockReturnValue("main");
    utils.getMergeRequestUrl.mockReturnValue("https://git.example/mr/new");

    expect(release.releasePush()).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git push origin release/1.2.3");
    expect(utils.getMergeRequestUrl).toHaveBeenCalledWith("release/1.2.3", "main");
    expect(utils.logSuccess).toHaveBeenCalledWith("🌐", "Создать Merge Request: %s", "https://git.example/mr/new");
    expect(git.goToMainBranch).toHaveBeenCalled();
  });

  test("releasePush handles missing URLs and push failures", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    utils.getMainBranch.mockReturnValue("main");
    utils.getMergeRequestUrl.mockReturnValue(null);

    expect(release.releasePush()).toBe(true);
    expect(utils.logSuccess).not.toHaveBeenCalledWith("🌐", expect.any(String), expect.any(String));

    utils.execCommand.mockReturnValue(false);
    expect(release.releasePush()).toBe(false);
  });

  test("derives the highest SemVer bump from fragment metadata", () => {
    expect(release.detectBumpType([{ bump: "patch" }, { bump: "major" }, { bump: "minor" }])).toBe("major");
    expect(release.detectBumpType([{ bump: "patch" }, { bump: "minor" }])).toBe("minor");
    expect(release.detectBumpType([{ bump: "patch" }])).toBe("patch");
    expect(release.detectBumpType([])).toBe("patch");
  });

  test("resolves release versions from the stable baseline instead of the dev reservation", () => {
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

  test("opens the next patch after stable and never downgrades an ahead dev", () => {
    expect(release.resolveNextDevelopmentVersion("1.1.0", "1.1.0")).toBe("1.1.1");
    expect(release.resolveNextDevelopmentVersion("1.1.1", "1.2.0")).toBe("1.2.0");
  });

  test("releaseStart wires fragment validation, bump, assembly, cleanup, and publication in order", async () => {
    runCommand.mockImplementation(async (spec) => spec);

    const spec = await release.releaseStart();

    expect(spec.context).toBeUndefined();
    expect(spec.checks.map((check) => check.name)).toEqual([
      "git-repo",
      "clean-working-tree",
      "branch-up-to-date",
      "main-and-dev-branches",
      "package-version",
      "on-dev-branch",
      "stable-version",
      "changelog-exists",
      "changelog-prettier-check",
      "changelog-fragments",
      "detect-bump-type",
    ]);
    expect(spec.steps.map((step) => step.name)).toEqual([
      "set-release-version",
      "run-install",
      "build-release-changelog",
      "remove-changelog-fragments",
      "lint-changelog",
      "create-release-branch",
      "commit-release",
      "push-release",
    ]);

    const bumpCheck = spec.checks.find((check) => check.name === "detect-bump-type");
    const bumpResult = bumpCheck.run({
      version: "1.4.3",
      stableVersion: "1.4.2",
      changelogFragments: [{ bump: "patch" }, { bump: "major" }],
    });
    expect(bumpResult).toEqual({
      ok: true,
      data: {
        bumpType: "major",
        newVersion: "2.0.0",
        releaseBranch: "release/2.0.0",
      },
    });
    expect(version.upVersion).toHaveBeenCalledWith("1.4.2", "major");
  });

  test("releaseStart rejects an existing release branch", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();
    utils.execSilent.mockReturnValueOnce("release/1.3.0");

    const bumpCheck = spec.checks.find((check) => check.name === "detect-bump-type");
    expect(bumpCheck.run({
      version: "1.2.1",
      stableVersion: "1.2.0",
      changelogFragments: [{ bump: "minor" }],
    }).ok).toBe(false);
  });

  test("patch release keeps the reserved dev version without a double bump", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();
    const bumpCheck = spec.checks.find((check) => check.name === "detect-bump-type");

    expect(bumpCheck.run({
      version: "1.1.1",
      stableVersion: "1.1.0",
      changelogFragments: [{ bump: "patch" }],
    })).toEqual({
      ok: true,
      data: {
        bumpType: "patch",
        newVersion: "1.1.1",
        releaseBranch: "release/1.1.1",
      },
    });
  });

  test("releaseStart steps update package files and stage consumed fragments", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();

    expect(spec.steps[0].run({ newVersion: "1.3.0" })).toBe(true);
    expect(version.updateVersionFileExact).toHaveBeenCalledWith("1.3.0");

    expect(spec.steps[1].run({})).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("npm install");

    const context = { newVersion: "1.3.0", changelogFragments: [{ filePath: ".changelog/a.added.md" }] };
    expect(spec.steps[2].run(context)).toBe(true);
    expect(changelog.changelogBuildRelease).toHaveBeenCalledWith(context);
    expect(spec.steps[3].run(context)).toBe(true);
    expect(changelog.changelogRemoveFragments).toHaveBeenCalledWith(context);

    expect(spec.steps[6].run(context)).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith(
      "git add --all -- CHANGELOG.md .changelog package.json package-lock.json"
    );
  });

  test("releaseStart fails changelog lint and install steps cleanly", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseStart();

    utils.execSilent.mockReturnValue(null);
    expect(spec.steps[4].run({})).toBe(false);

    utils.getPackageManager.mockReturnValue("yarn");
    utils.execCommand.mockReturnValue(false);
    expect(spec.steps[1].run({})).toBe(false);
  });

  test("releaseClose delegates and exposes merge and push failures", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseClose();

    utils.getMainBranch.mockReturnValue("main");
    utils.execCommand.mockImplementation((command) => command !== "git merge main");
    expect(spec.steps[4].run({})).toBe(false);

    utils.getCurrentBranch.mockReturnValue("dev");
    utils.execCommand.mockImplementation((command) => command !== "git push origin dev");
    expect(spec.steps[8].run({})).toBe(false);
  });

  test("releaseClose writes and commits the next patch version", async () => {
    runCommand.mockImplementation(async (spec) => spec);
    const spec = await release.releaseClose();
    const context = { stableVersion: "1.1.0" };
    utils.getVersion.mockReturnValue("1.1.0");

    expect(spec.steps[5].run(context)).toBe(true);
    expect(context).toMatchObject({
      nextDevelopmentVersion: "1.1.1",
      developmentVersionChanged: true,
    });
    expect(version.updateVersionFileExact).toHaveBeenCalledWith("1.1.1");
    expect(spec.steps[6].run(context)).toBe(true);
    expect(spec.steps[7].run(context)).toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("git add -- package.json package-lock.json");
    expect(utils.execCommand).toHaveBeenCalledWith(
      'git commit --message "🔖 Открыть разработку версии 1.1.1." --no-verify'
    );
  });
});
