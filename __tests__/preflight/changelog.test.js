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

describe("preflight changelog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.getMainBranch.mockReturnValue("main");
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

  test("requireFileExists", () => {
    fs.existsSync.mockReturnValue(true);
    expect(preflight.requireFileExists("x").ok).toBe(true);
    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireFileExists("x").ok).toBe(false);
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
      { name: "SPEC-3-old-api.removed.md", isFile: () => true },
    ]);
    fs.readFileSync.mockImplementation((filePath) => {
      if (normalizePath(filePath).endsWith("added.md")) return "- SPEC-1 Добавлен API.\n";
      if (normalizePath(filePath).endsWith("removed.md")) return "- SPEC-3 Удалён старый API.\n";
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
          {
            filePath: ".changelog/SPEC-3-old-api.removed.md",
            type: "removed",
            section: "### 🗑 Removed",
            bump: "major",
            entries: ["- SPEC-3 Удалён старый API."],
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

});
