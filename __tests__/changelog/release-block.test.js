#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");

jest.mock("fs");
jest.mock("readline");
jest.mock("../../src/common/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  colors: {
    yellow: "<y>",
    green: "<g>",
    reset: "<r>",
  },
}));

const utils = require("../../src/common/utils");
const changelog = require("../../src/changelog");
const { getFragmentType } = require("../../src/changelog/config");

describe("changelog release-block", () => {
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    fs.existsSync.mockImplementation((filePath) => filePath === "CHANGELOG.md");
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-8-new-ui");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    utils.execCommand.mockReturnValue(true);
  });

  afterAll(() => {
    console.log = originalLog;
  });

  function mockQuestionAnswers(answers) {
    let index = 0;
    readline.createInterface.mockImplementation(() => ({
      question: (_question, callback) => callback(answers[index++]),
      close: jest.fn(),
    }));
  }

  test("removes a legacy Unreleased block", () => {
    const input = [
      "# Changelog",
      "",
      "Intro.",
      "",
      "## [Unreleased]",
      "",
      "### 🆕 Added",
      "",
      "_Placeholder._",
      "",
      "## 🚀 [1.0.0] - 2026-01-01",
      "",
      "### 🪲 Fixed",
      "",
      "- Old fix.",
      "",
    ].join("\n");

    expect(changelog.stripLegacyUnreleasedBlock(input)).toBe([
      "# Changelog",
      "",
      "Intro.",
      "",
      "## 🚀 [1.0.0] - 2026-01-01",
      "",
      "### 🪲 Fixed",
      "",
      "- Old fix.",
      "",
    ].join("\n"));
  });

  test("renders fragments in stable section order", () => {
    const fragments = [
      { type: "fixed", entries: ["- SPEC-2 Исправлено."] },
      { type: "added", entries: ["- SPEC-1 Добавлено."] },
      { type: "fixed", entries: ["- SPEC-3 Ещё исправлено."] },
    ];

    expect(changelog.renderReleaseBlock("1.2.0", fragments, "2026-08-25")).toBe([
      "## 🚀 [1.2.0] - 2026-08-25",
      "",
      "### 🆕 Added",
      "",
      "- SPEC-1 Добавлено.",
      "",
      "### 🪲 Fixed",
      "",
      "- SPEC-2 Исправлено.",
      "- SPEC-3 Ещё исправлено.",
      "",
    ].join("\n"));
  });

  test("inserts a release before older releases and rejects duplicate versions", () => {
    const changelogText = "# Changelog\n\nIntro.\n\n## 🚀 [1.0.0] - 2026-01-01\n\n- Old.\n";
    const releaseBlock = "## 🚀 [1.1.0] - 2026-08-25\n\n### 🆕 Added\n\n- New.\n";
    const result = changelog.insertReleaseBlock(changelogText, releaseBlock, "1.1.0");

    expect(result.indexOf("[1.1.0]")).toBeLessThan(result.indexOf("[1.0.0]"));
    expect(() => changelog.insertReleaseBlock(result, releaseBlock, "1.1.0")).toThrow(
      "Версия 1.1.0 уже присутствует"
    );
  });

  test("builds the release changelog and removes consumed fragments", () => {
    const fragments = [
      { filePath: ".changelog/a.added.md", type: "added", entries: ["- Added."] },
      { filePath: ".changelog/b.fixed.md", type: "fixed", entries: ["- Fixed."] },
    ];
    fs.readFileSync.mockReturnValue("# Changelog\n\n## 🚀 [1.0.0] - 2026-01-01\n\n- Old.\n");
    const context = { newVersion: "1.1.0", changelogFragments: fragments };

    expect(changelog.changelogBuildRelease(context, "2026-08-25")).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "CHANGELOG.md",
      expect.stringContaining("## 🚀 [1.1.0] - 2026-08-25")
    );
    expect(changelog.changelogRemoveFragments(context)).toBe(true);
    expect(fs.unlinkSync).toHaveBeenNthCalledWith(1, ".changelog/a.added.md");
    expect(fs.unlinkSync).toHaveBeenNthCalledWith(2, ".changelog/b.fixed.md");
  });

  test("returns false when release context is incomplete or file operations fail", () => {
    expect(changelog.changelogBuildRelease({})).toBe(false);
    expect(changelog.changelogRemoveFragments({})).toBe(false);

    fs.readFileSync.mockImplementation(() => {
      throw new Error("read failed");
    });
    expect(changelog.changelogBuildRelease({ newVersion: "1.0.0", changelogFragments: [{}] })).toBe(false);

    fs.unlinkSync.mockImplementation(() => {
      throw new Error("remove failed");
    });
    expect(changelog.changelogRemoveFragments({ changelogFragments: [{ filePath: "a" }] })).toBe(false);
  });

});
