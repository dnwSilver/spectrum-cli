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

describe("preflight release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.getMainBranch.mockReturnValue("main");
  });

  test("reads the release version from the top changelog heading", () => {
    fs.readFileSync.mockReturnValue([
      "# Changelog",
      "",
      "## 🚀 [1.3.0] - 2026-08-27",
      "",
      "### 🆕 Added",
      "",
      "- SPEC-1 Новая фича.",
      "",
      "## 🚀 [1.2.0] - 2026-08-01",
    ].join("\n"));
    expect(preflight.getChangelogReleaseVersions()).toEqual(["1.3.0", "1.2.0"]);
    expect(preflight.getChangelogReleaseVersion()).toBe("1.3.0");
    expect(preflight.requireChangelogReleaseVersion()).toEqual({
      ok: true,
      data: { version: "1.3.0" },
    });

    fs.readFileSync.mockReturnValue("## [2.0.1] - 2026-01-01\n");
    expect(preflight.getChangelogReleaseVersion()).toBe("2.0.1");

    fs.readFileSync.mockReturnValue("# Changelog\n\nБез релизов.\n");
    expect(preflight.getChangelogReleaseVersion()).toBeNull();
    expect(preflight.requireChangelogReleaseVersion().ok).toBe(false);

    fs.readFileSync.mockImplementation(() => {
      throw new Error("missing");
    });
    expect(preflight.getChangelogReleaseVersion()).toBeNull();
    expect(preflight.requireChangelogReleaseVersion().ok).toBe(false);
  });

  test("blocks release start while newer changelog releases have no stable tag", () => {
    fs.readFileSync.mockReturnValue([
      "# Changelog",
      "",
      "## 🚀 [0.0.2] - 2026-08-28",
      "",
      "## 🚀 [0.1.0] - 2026-08-28",
      "",
      "## [0.0.1]",
    ].join("\n"));

    const pendingResult = preflight.requireNoPendingRelease("0.0.1");
    expect(pendingResult.ok).toBe(false);
    expect(pendingResult.reason).toContain("0.1.0, 0.0.2");
    expect(pendingResult.reason).toContain("0.0.1");
    expect(pendingResult.reason).toContain("spectrum release deploy");
    expect(pendingResult.reason).toContain("spectrum release close");

    fs.readFileSync.mockReturnValue("## 🚀 [1.2.3]\n\n## 🚀 [1.2.2]\n");
    expect(preflight.requireNoPendingRelease("1.2.3")).toEqual({
      ok: true,
      data: { changelogReleaseVersions: ["1.2.3", "1.2.2"] },
    });

    fs.readFileSync.mockReturnValue("# Changelog\n\nБез релизов.\n");
    expect(preflight.requireNoPendingRelease("1.2.3")).toEqual({
      ok: true,
      data: { changelogReleaseVersions: [] },
    });
    expect(preflight.requireNoPendingRelease("invalid").ok).toBe(false);
  });

  test("selects the highest stable tag reachable from origin main and ignores prereleases", () => {
    utils.execSilent
      .mockReturnValueOnce([
        "v1.2.9",
        "v1.10.0",
        "v8.0.0",
        "v2.0.0-rc.1",
        "not-a-version",
      ].join("\n"))
      .mockReturnValueOnce([
        "aaa refs/tags/v1.2.9",
        "bbb refs/tags/v1.10.0",
        "ccc refs/tags/v9.0.0",
        "ddd refs/tags/v2.0.0-rc.1",
      ].join("\n"));

    expect(preflight.requireLatestStableVersion()).toEqual({
      ok: true,
      data: { stableVersion: "1.10.0" },
    });
    expect(utils.execSilent).toHaveBeenCalledWith(
      'git tag --merged origin/main --list "release/*" "hotfix/*" "v*"'
    );
    expect(utils.execSilent).toHaveBeenCalledWith(
      'git ls-remote --refs --tags origin "refs/tags/release/*" "refs/tags/hotfix/*" "refs/tags/v*"'
    );

    utils.execSilent.mockReturnValue("");
    expect(preflight.requireLatestStableVersion().ok).toBe(false);
  });

  test("requires the stable remote tag to point at HEAD", () => {
    utils.execSilent
      .mockReturnValueOnce("abc123")
      .mockReturnValueOnce("tag-object refs/tags/v1.2.3\nabc123 refs/tags/v1.2.3^{}");
    expect(preflight.requireStableTagAtHead("1.2.3")).toEqual({
      ok: true,
      data: { stableVersion: "1.2.3" },
    });

    utils.execSilent
      .mockReturnValueOnce("different")
      .mockReturnValueOnce("abc123 refs/tags/v1.2.3");
    expect(preflight.requireStableTagAtHead("1.2.3").ok).toBe(false);
  });

  test("validates YouTrack task IDs", () => {
    expect(preflight.requireYouTrackTask("AR-123")).toEqual({
      ok: true,
      data: { task: "AR-123" },
    });
    expect(preflight.requireYouTrackTask("ABBVJSOP-1").ok).toBe(true);
    expect(preflight.requireYouTrackTask("ar-123").ok).toBe(false);
    expect(preflight.requireYouTrackTask("AR123").ok).toBe(false);
  });

  test("requireTagMissing", () => {
    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("");
    expect(preflight.requireTagMissing("v1.2.3").ok).toBe(true);

    utils.execSilent.mockReturnValueOnce("v1.2.3");
    expect(preflight.requireTagMissing("v1.2.3").ok).toBe(false);

    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("abc refs/tags/chart-app-1.2.3");
    expect(preflight.requireTagMissing("chart-app-1.2.3").ok).toBe(false);

    utils.execSilent.mockReturnValueOnce("chart-app-1.2.3");
    expect(preflight.requireTagMissing("chart-app-1.2.3").ok).toBe(false);
  });

  test("rejects release versions already reserved by hotfix branches or tags", () => {
    utils.execSilent
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("");
    expect(preflight.requireReleaseVersionAvailable("1.2.3").ok).toBe(true);
    expect(utils.execSilent).toHaveBeenNthCalledWith(
      1,
      'git branch --list "hotfix/*-1.2.3"'
    );
    expect(utils.execSilent).toHaveBeenNthCalledWith(
      2,
      'git ls-remote --heads origin "refs/heads/hotfix/*-1.2.3"'
    );
    expect(utils.execSilent).toHaveBeenNthCalledWith(3, 'git tag --list "release/1.2.3" "hotfix/1.2.3" "v1.2.3"');
    expect(utils.execSilent).toHaveBeenNthCalledWith(
      4,
      'git ls-remote --tags origin "refs/tags/release/1.2.3" "refs/tags/release/1.2.3^{}" "refs/tags/hotfix/1.2.3" "refs/tags/hotfix/1.2.3^{}" "refs/tags/v1.2.3" "refs/tags/v1.2.3^{}"'
    );

    utils.execSilent.mockReturnValueOnce("hotfix/AR-123-1.2.3");
    expect(preflight.requireReleaseVersionAvailable("1.2.3").ok).toBe(false);

    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("sha refs/heads/hotfix/AR-124-1.2.3");
    expect(preflight.requireReleaseVersionAvailable("1.2.3").ok).toBe(false);

    utils.execSilent
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("v1.2.3");
    expect(preflight.requireReleaseVersionAvailable("1.2.3").ok).toBe(false);

    utils.execSilent
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("sha refs/tags/v1.2.3");
    expect(preflight.requireReleaseVersionAvailable("1.2.3").ok).toBe(false);
    expect(preflight.requireReleaseVersionAvailable("1.2.3-rc.1").ok).toBe(false);
  });

});
