#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../src/utils", () => ({
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
}));

const utils = require("../src/utils");
const preflight = require("../src/preflight");

function normalizePath(p) {
  return String(p).replace(/\\/g, "/");
}

describe("preflight", () => {
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
    expect(pendingResult.reason).toContain("v0.0.1");
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

  test("requireChartChangelogVersion validates chart changelog heading", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue([
      "# Changelog",
      "",
      "## [0.0.11] - 2026-08-28",
      "",
      "- Новая версия.",
      "",
      "## [0.0.10] - 2026-07-20",
    ].join("\n"));

    expect(preflight.requireChartChangelogVersion("charts/elksite", "0.0.11")).toEqual({
      ok: true,
      data: { chartChangelogPath: "charts/elksite/CHANGELOG.md" },
    });

    const missingVersion = preflight.requireChartChangelogVersion("charts/elksite", "0.0.12");
    expect(missingVersion.ok).toBe(false);
    expect(missingVersion.reason).toContain('"## [0.0.12]"');

    fs.readFileSync.mockReturnValue("## 🚀 [0.0.11] - 2026-08-28\n");
    expect(preflight.requireChartChangelogVersion("charts/elksite", "0.0.11").ok).toBe(true);

    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireChartChangelogVersion("charts/elksite", "0.0.11").ok).toBe(false);

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => {
      throw new Error("read error");
    });
    expect(preflight.requireChartChangelogVersion("charts/elksite", "0.0.11").ok).toBe(false);
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
      'git tag --merged origin/main --list "v*"'
    );
    expect(utils.execSilent).toHaveBeenCalledWith(
      'git ls-remote --refs --tags origin "refs/tags/v*"'
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

  test("requireSingleChart", () => {
    fs.existsSync.mockImplementation((p) => p === "charts" || p === "charts/app/Chart.yaml");
    fs.readdirSync.mockReturnValue([{ name: "app", isDirectory: () => true }]);
    fs.readFileSync.mockReturnValue("name: app\n");

    expect(preflight.requireSingleChart()).toEqual({
      ok: true,
      data: { chartFilePath: "charts/app/Chart.yaml", chartName: "app" },
    });
  });

  test("extractYamlList keeps hash in regex value", () => {
    const yaml = [
      "ingress:",
      "  paths:",
      "    assets:",
      "      - /_next/image(\\?[^#]*)?$",
    ].join("\n");

    expect(preflight.extractYamlList(yaml, "assets")).toEqual([
      "/_next/image(\\?[^#]*)?$",
    ]);
  });

  test("findHelmReleaseFiles and requireHelmReleaseFiles", () => {
    fs.existsSync.mockImplementation((p) => {
      const np = normalizePath(p);
      return (
        np === "." ||
        np === "apps" ||
        np === "apps/api" ||
        np === "apps/api/helmrelease.yaml" ||
        np === "apps/web" ||
        np === "apps/web/helmrelease.yaml"
      );
    });
    fs.readdirSync.mockImplementation((dirPath) => {
      const nd = normalizePath(dirPath);
      if (nd === ".") {
        return [
          { name: "apps", isDirectory: () => true, isFile: () => false },
          { name: ".git", isDirectory: () => true, isFile: () => false },
        ];
      }
      if (nd === "apps") {
        return [
          { name: "api", isDirectory: () => true, isFile: () => false },
          { name: "web", isDirectory: () => true, isFile: () => false },
        ];
      }
      if (nd === "apps/api") {
        return [{ name: "helmrelease.yaml", isDirectory: () => false, isFile: () => true }];
      }
      if (nd === "apps/web") {
        return [{ name: "helmrelease.yaml", isDirectory: () => false, isFile: () => true }];
      }
      return [];
    });

    expect(preflight.findHelmReleaseFiles(".")).toEqual([
      "apps/api/helmrelease.yaml",
      "apps/web/helmrelease.yaml",
    ]);
    expect(preflight.requireHelmReleaseFiles()).toEqual({
      ok: true,
      data: {
        helmReleaseFiles: ["apps/api/helmrelease.yaml", "apps/web/helmrelease.yaml"],
      },
    });
  });

  test("getPrettierRunner supports npx and direct binaries", () => {
    utils.execSilent.mockImplementation((cmd) => {
      if (cmd === "npx --yes prettier --version") return "3.0.0";
      return null;
    });
    expect(preflight.getPrettierRunner()).toBe("npx --yes prettier");

    utils.execSilent.mockImplementation((cmd) => {
      if (cmd === "npx --yes prettier --version") return null;
      if (cmd === "prettier --version") return "3.0.0";
      return null;
    });
    expect(preflight.getPrettierRunner()).toBe("prettier");

    utils.execSilent.mockReturnValue(null);
    expect(preflight.getPrettierRunner()).toBeNull();
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

  test("requireFileExists", () => {
    fs.existsSync.mockReturnValue(true);
    expect(preflight.requireFileExists("x").ok).toBe(true);
    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireFileExists("x").ok).toBe(false);
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
    expect(utils.execSilent).toHaveBeenNthCalledWith(3, 'git tag --list "v1.2.3"');
    expect(utils.execSilent).toHaveBeenNthCalledWith(
      4,
      'git ls-remote --tags origin "refs/tags/v1.2.3" "refs/tags/v1.2.3^{}"'
    );
    expect(utils.execSilent).not.toHaveBeenCalledWith(expect.stringContaining("release/1.2.3"));

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

  test("requirePrettierAvailable and requireChangelogFormatted", () => {
    utils.execSilent.mockImplementation((cmd) => {
      if (cmd === "npx --yes prettier --version") return "3.0.0";
      return null;
    });
    expect(preflight.requirePrettierAvailable().ok).toBe(true);

    utils.execCommand.mockReturnValue(true);
    expect(preflight.requireChangelogFormatted().ok).toBe(true);
    utils.execCommand.mockReturnValue(false);
    expect(preflight.requireChangelogFormatted().ok).toBe(false);

    utils.execSilent.mockReturnValue(null);
    expect(preflight.requirePrettierAvailable().ok).toBe(false);
  });

  test("findChangelogFragmentFiles returns sorted visible files", () => {
    fs.existsSync.mockImplementation((filePath) => normalizePath(filePath) === ".changelog");
    fs.readdirSync.mockReturnValue([
      { name: "b.fixed.md", isFile: () => true },
      { name: ".gitkeep", isFile: () => true },
      { name: "nested", isFile: () => false },
      { name: "a.added.md", isFile: () => true },
    ]);

    expect(preflight.findChangelogFragmentFiles()).toEqual([
      ".changelog/a.added.md",
      ".changelog/b.fixed.md",
    ]);
  });

  test("requireChangelogFragments parses type, bump, and entries", () => {
    fs.existsSync.mockImplementation((filePath) => normalizePath(filePath) === ".changelog");
    fs.readdirSync.mockReturnValue([
      { name: "SPEC-2-fix.fixed.md", isFile: () => true },
      { name: "SPEC-1-api.added.md", isFile: () => true },
    ]);
    fs.readFileSync.mockImplementation((filePath) => {
      if (normalizePath(filePath).endsWith("added.md")) return "- SPEC-1 Добавлен API.\n";
      return "- SPEC-2 Исправлена ошибка.\n- SPEC-3 Исправлен крайний случай.\n";
    });

    expect(preflight.requireChangelogFragments()).toEqual({
      ok: true,
      data: {
        changelogFragments: [
          {
            filePath: ".changelog/SPEC-1-api.added.md",
            type: "added",
            section: "### 🆕 Added",
            bump: "minor",
            entries: ["- SPEC-1 Добавлен API."],
          },
          {
            filePath: ".changelog/SPEC-2-fix.fixed.md",
            type: "fixed",
            section: "### 🪲 Fixed",
            bump: "patch",
            entries: ["- SPEC-2 Исправлена ошибка.", "- SPEC-3 Исправлен крайний случай."],
          },
        ],
      },
    });
  });

  test("requireChangelogFragments rejects missing, empty, and malformed fragments", () => {
    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireChangelogFragments().ok).toBe(false);

    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([]);
    expect(preflight.requireChangelogFragments().ok).toBe(false);

    fs.readdirSync.mockReturnValue([{ name: "SPEC-1-added.md", isFile: () => true }]);
    expect(preflight.requireChangelogFragments().reason).toContain("Неверное имя");

    fs.readdirSync.mockReturnValue([{ name: "SPEC-1.added.md", isFile: () => true }]);
    fs.readFileSync.mockReturnValue("\n");
    expect(preflight.requireChangelogFragments().reason).toContain("пуст");

    fs.readFileSync.mockReturnValue("SPEC-1 missing bullet\n");
    expect(preflight.requireChangelogFragments().reason).toContain("должна начинаться");

    fs.readFileSync.mockImplementation(() => {
      throw new Error("read failed");
    });
    expect(preflight.requireChangelogFragments().reason).toContain("Не удалось прочитать");
  });

  test("findValuesYamlFiles and requireSingleValuesYaml", () => {
    fs.existsSync.mockImplementation((p) => {
      const np = normalizePath(p);
      return np === "charts" || np === "charts/app" || np === "charts/app/values.yaml";
    });
    fs.readdirSync.mockImplementation((p) => {
      const np = normalizePath(p);
      if (np === "charts") return [{ name: "app", isDirectory: () => true, isFile: () => false }];
      if (np === "charts/app") return [{ name: "values.yaml", isDirectory: () => false, isFile: () => true }];
      return [];
    });
    expect(preflight.findValuesYamlFiles("charts")).toEqual(["charts/app/values.yaml"]);
    expect(preflight.requireSingleValuesYaml().ok).toBe(true);

    fs.readdirSync.mockImplementation((p) => {
      const np = normalizePath(p);
      if (np === "charts") return [
        { name: "a", isDirectory: () => true, isFile: () => false },
        { name: "b", isDirectory: () => true, isFile: () => false },
      ];
      if (np === "charts/a" || np === "charts/b") return [{ name: "values.yaml", isDirectory: () => false, isFile: () => true }];
      return [];
    });
    fs.existsSync.mockImplementation((p) => {
      const np = normalizePath(p);
      return ["charts", "charts/a", "charts/b", "charts/a/values.yaml", "charts/b/values.yaml"].includes(np);
    });
    expect(preflight.requireSingleValuesYaml().ok).toBe(false);
  });

  test("requireIngressPathSections validations", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue([
      "ingress:",
      "  paths:",
      "    api:",
      "      - /api$",
      "    pages:",
      "      - /$",
      "    assets:",
      "      - /_next$",
    ].join("\n"));
    expect(preflight.requireIngressPathSections("charts/app/values.yaml").ok).toBe(true);

    fs.readFileSync.mockReturnValue("ingress:\n  paths:\n    api:\n      - /api$");
    expect(preflight.requireIngressPathSections("charts/app/values.yaml").ok).toBe(false);

    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireIngressPathSections("charts/app/values.yaml").ok).toBe(false);
  });

  test("requireSourcePathDirectory", () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => true });
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(true);

    fs.statSync.mockReturnValue({ isDirectory: () => false });
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(false);

    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(false);
  });

  test("requireNextProject", () => {
    fs.existsSync.mockImplementation((p) => {
      const np = normalizePath(p);
      return np.endsWith("/package.json") || np.endsWith("/next.config.js") || np.endsWith("/yarn.lock");
    });
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: { next: "14.0.0" } }));
    expect(preflight.requireNextProject("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireNextProject("/src").ok).toBe(false);

    fs.existsSync.mockImplementation((p) => normalizePath(p).endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    expect(preflight.requireNextProject("/src").ok).toBe(false);
  });

  test("requireBuildCommandSupport", () => {
    fs.existsSync.mockImplementation((p) => normalizePath(p).endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: { build: "next build" } }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);
  });
});
