#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const release = require("../src/release");
const preflight = require("../src/preflight");
const changelog = require("../src/changelog");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

describe("tag-based release flow with a temporary origin", () => {
  let tempDir;
  let workDir;
  let originDir;
  let originalCwd;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectrum-release-flow-"));
    workDir = path.join(tempDir, "work");
    originDir = path.join(tempDir, "origin.git");
    originalCwd = process.cwd();

    fs.mkdirSync(workDir);
    git(tempDir, "init", "--bare", originDir);
    git(originDir, "config", "receive.advertisePushOptions", "true");
    git(workDir, "init", "--initial-branch=master");
    git(workDir, "config", "user.name", "Release Test");
    git(workDir, "config", "user.email", "release-test@example.com");
    git(workDir, "remote", "add", "origin", originDir);

    // package.json заморожен: версия в нем не участвует в релизном процессе
    fs.writeFileSync(
      path.join(workDir, "package.json"),
      `${JSON.stringify({ name: "release-flow-fixture", version: "0.0.0", private: true }, null, 2)}\n`
    );
    fs.writeFileSync(path.join(workDir, "CHANGELOG.md"), "# Changelog\n");
    git(workDir, "add", ".");
    git(workDir, "commit", "-m", "Initial stable 0.0.1");
    git(workDir, "tag", "v0.0.1");
    git(workDir, "push", "--set-upstream", "origin", "master", "--tags");

    // Теги-обманки: недостижимый из master, prerelease и локальный без origin
    git(workDir, "switch", "-c", "unreleased-side-branch");
    fs.writeFileSync(path.join(workDir, "side-change.txt"), "not released\n");
    git(workDir, "add", "side-change.txt");
    git(workDir, "commit", "-m", "Unreleased side branch");
    git(workDir, "tag", "v9.0.0");
    git(workDir, "push", "origin", "unreleased-side-branch", "v9.0.0");
    git(workDir, "switch", "master");
    git(workDir, "tag", "v0.2.0-rc.1");
    git(workDir, "push", "origin", "v0.2.0-rc.1");
    git(workDir, "tag", "v8.0.0");

    git(workDir, "switch", "-c", "dev");
    git(workDir, "push", "--set-upstream", "origin", "dev");
    fs.mkdirSync(path.join(workDir, ".changelog"));
    fs.writeFileSync(
      path.join(workDir, ".changelog", "SPEC-1-feature.added.md"),
      "- SPEC-1 Добавлена возможность.\n"
    );
    git(workDir, "add", ".changelog");
    git(workDir, "commit", "-m", "Add changelog fragment");
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("collapses fragments on dev and publishes the release snapshot without version files", () => {
    expect(preflight.requireLatestStableVersion()).toEqual({
      ok: true,
      data: { stableVersion: "0.0.1" },
    });

    const fragmentsResult = preflight.requireChangelogFragments();
    expect(fragmentsResult.ok).toBe(true);
    const fragments = fragmentsResult.data.changelogFragments;

    const resolved = release.resolveReleaseVersion("0.0.1", fragments);
    expect(resolved).toEqual({ bumpType: "minor", newVersion: "0.1.0" });

    const context = {
      mainBranch: "master",
      devBranch: "dev",
      newVersion: resolved.newVersion,
      changelogFragments: fragments,
    };

    expect(changelog.changelogBuildRelease(context, "2026-08-27")).toBe(true);
    expect(changelog.changelogRemoveFragments(context)).toBe(true);
    expect(release.releaseCommit(context)).toBe(true);
    expect(release.releasePush(context)).toBe(true);

    const devCommit = git(workDir, "rev-parse", "HEAD");
    expect(git(originDir, "rev-parse", "refs/heads/dev")).toBe(devCommit);
    expect(git(originDir, "rev-parse", "refs/heads/master")).toBe(devCommit);
    expect(git(workDir, "rev-parse", "HEAD^")).not.toBe(devCommit);

    // Версия релиза читается из заголовка CHANGELOG, package.json остается замороженным
    expect(preflight.getChangelogReleaseVersion()).toBe("0.1.0");
    expect(fs.existsSync(path.join(workDir, ".changelog", "SPEC-1-feature.added.md"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(workDir, "package.json"), "utf8")).version).toBe("0.0.0");
    expect(git(workDir, "branch", "--show-current")).toBe("dev");
    expect(git(workDir, "status", "--porcelain")).toBe("");

    // Схлопнутый CHANGELOG уехал одним commit в origin/dev и origin/master
    const remoteChangelog = git(workDir, "show", "origin/dev:CHANGELOG.md");
    expect(remoteChangelog).toContain("## 🚀 [0.1.0] - 2026-08-27");
    expect(remoteChangelog).toContain("- SPEC-1 Добавлена возможность.");
    expect(git(workDir, "show", "origin/master:CHANGELOG.md")).toBe(remoteChangelog);

    fs.writeFileSync(
      path.join(workDir, ".changelog", "SPEC-2-follow-up.support.md"),
      "- SPEC-2 Выполнена поддержка.\n"
    );
    const followUpFragments = preflight.requireChangelogFragments().data.changelogFragments;
    expect(release.resolveReleaseVersion("0.0.1", followUpFragments)).toEqual({
      bumpType: "patch",
      newVersion: "0.0.2",
    });

    const changelogBeforeBlockedStart = fs.readFileSync(path.join(workDir, "CHANGELOG.md"), "utf8");
    const pendingResult = preflight.requireNoPendingRelease("0.0.1");
    expect(pendingResult.ok).toBe(false);
    expect(pendingResult.reason).toContain("0.1.0");
    expect(fs.readFileSync(path.join(workDir, "CHANGELOG.md"), "utf8")).toBe(changelogBeforeBlockedStart);

    git(workDir, "tag", "v0.1.0");
    git(workDir, "push", "origin", "v0.1.0");
    expect(preflight.requireLatestStableVersion()).toEqual({
      ok: true,
      data: { stableVersion: "0.1.0" },
    });
    expect(preflight.requireNoPendingRelease("0.1.0").ok).toBe(true);
  });
});
