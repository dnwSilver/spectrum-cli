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

describe("preflight chart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.getMainBranch.mockReturnValue("main");
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

    expect(preflight.requireChartChangelogVersion("charts/elksite")).toEqual({
      ok: true,
      data: { chartChangelogPath: "charts/elksite/CHANGELOG.md", version: "0.0.11" },
    });

    fs.readFileSync.mockReturnValue("## 🚀 [0.0.11] - 2026-08-28\n");
    expect(preflight.requireChartChangelogVersion("charts/elksite").data.version).toBe("0.0.11");

    fs.readFileSync.mockReturnValue("## [Unreleased]\n\n## [0.0.11]\n");
    expect(preflight.requireChartChangelogVersion("charts/elksite").ok).toBe(false);

    fs.readFileSync.mockReturnValue("## [0.0.11.2]\n\n## [0.0.11]\n");
    expect(preflight.requireChartChangelogVersion("charts/elksite").ok).toBe(false);

    fs.readFileSync.mockReturnValue("## [0.0.11]\n\n## [0.0.12]\n");
    expect(preflight.requireChartChangelogVersion("charts/elksite").data.version).toBe("0.0.11");

    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireChartChangelogVersion("charts/elksite").ok).toBe(false);

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => {
      throw new Error("read error");
    });
    expect(preflight.requireChartChangelogVersion("charts/elksite").ok).toBe(false);
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

});
