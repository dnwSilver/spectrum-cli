#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../src/utils", () => ({
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
  getVersion: jest.fn(),
}));

const utils = require("../src/utils");
const preflight = require("../src/preflight");

describe("preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test("requirePackageVersion", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    expect(preflight.requirePackageVersion()).toEqual({ ok: true, data: { version: "1.2.3" } });

    utils.getVersion.mockReturnValue("latest");
    expect(preflight.requirePackageVersion().ok).toBe(false);
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
    fs.existsSync.mockImplementation((p) => (
      p === "." ||
      p === "apps" ||
      p === "apps/api" ||
      p === "apps/api/helmrelease.yaml" ||
      p === "apps/web" ||
      p === "apps/web/helmrelease.yaml"
    ));
    fs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === ".") {
        return [
          { name: "apps", isDirectory: () => true, isFile: () => false },
          { name: ".git", isDirectory: () => true, isFile: () => false },
        ];
      }
      if (dirPath === "apps") {
        return [
          { name: "api", isDirectory: () => true, isFile: () => false },
          { name: "web", isDirectory: () => true, isFile: () => false },
        ];
      }
      if (dirPath === "apps/api") {
        return [{ name: "helmrelease.yaml", isDirectory: () => false, isFile: () => true }];
      }
      if (dirPath === "apps/web") {
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

  test("requireOnReleaseBranch and requireReleaseBranchMissing", () => {
    utils.getCurrentBranch.mockReturnValue("release/1.2.3");
    expect(preflight.requireOnReleaseBranch().ok).toBe(true);

    utils.getCurrentBranch.mockReturnValue("main");
    expect(preflight.requireOnReleaseBranch().ok).toBe(false);

    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("");
    expect(preflight.requireReleaseBranchMissing("release/1.2.3").ok).toBe(true);
    utils.execSilent.mockReturnValueOnce("release/1.2.3");
    expect(preflight.requireReleaseBranchMissing("release/1.2.3").ok).toBe(false);
    utils.execSilent.mockReturnValueOnce("").mockReturnValueOnce("sha refs/heads/release/1.2.3");
    expect(preflight.requireReleaseBranchMissing("release/1.2.3").ok).toBe(false);
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

  test("findValuesYamlFiles and requireSingleValuesYaml", () => {
    fs.existsSync.mockImplementation((p) => p === "charts" || p === "charts/app" || p === "charts/app/values.yaml");
    fs.readdirSync.mockImplementation((p) => {
      if (p === "charts") return [{ name: "app", isDirectory: () => true, isFile: () => false }];
      if (p === "charts/app") return [{ name: "values.yaml", isDirectory: () => false, isFile: () => true }];
      return [];
    });
    expect(preflight.findValuesYamlFiles("charts")).toEqual(["charts/app/values.yaml"]);
    expect(preflight.requireSingleValuesYaml().ok).toBe(true);

    fs.readdirSync.mockImplementation((p) => {
      if (p === "charts") return [
        { name: "a", isDirectory: () => true, isFile: () => false },
        { name: "b", isDirectory: () => true, isFile: () => false },
      ];
      if (p === "charts/a" || p === "charts/b") return [{ name: "values.yaml", isDirectory: () => false, isFile: () => true }];
      return [];
    });
    fs.existsSync.mockImplementation((p) => ["charts", "charts/a", "charts/b", "charts/a/values.yaml", "charts/b/values.yaml"].includes(p));
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
    fs.existsSync.mockImplementation((p) => (
      p.endsWith("/package.json") || p.endsWith("/next.config.js") || p.endsWith("/yarn.lock")
    ));
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: { next: "14.0.0" } }));
    expect(preflight.requireNextProject("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireNextProject("/src").ok).toBe(false);

    fs.existsSync.mockImplementation((p) => p.endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    expect(preflight.requireNextProject("/src").ok).toBe(false);
  });

  test("requireBuildCommandSupport", () => {
    fs.existsSync.mockImplementation((p) => p.endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: { build: "next build" } }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);
  });
});
