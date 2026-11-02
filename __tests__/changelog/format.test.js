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

describe("changelog format", () => {
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

  test("normalizes legacy release headings without changing dates or entries", () => {
    const input = [
      "# Changelog", "", "## 🚀[5.11.19] - 2022.08.24", "", "- Old entry.", "",
      "## 🩹[5.10.17] - 2022.08.22", "", "- Another entry.", "",
      "## [5.10.7]", "", "- Third entry.", "",
    ].join("\n");
    const output = changelog.normalizeChangelogHeadings(input);

    expect(output).toContain("## 🚀 [5.11.19] - 2022.08.24");
    expect(output).toContain("## 🩹 [5.10.17] - 2022.08.22");
    expect(output).toContain("## [5.10.7]");
    expect(output).toContain("- Old entry.\n\n## 🩹 [5.10.17]");
    expect(changelog.normalizeChangelogHeadings(output)).toBe(output);
  });

  test("preserves CRLF and rejects headings that cannot be normalized safely", () => {
    expect(changelog.normalizeChangelogHeadings("## 🩹[1.2.3] - 01.10.2026\r\n"))
      .toBe("## 🩹 [1.2.3] - 01.10.2026\r\n");
    for (const heading of ["## [Unreleased]", "## 🚀 [01.2.3]", "## Legend", "## 🚀 [1.2.3] - tomorrow"]) {
      expect(() => changelog.normalizeChangelogHeadings(`${heading}\n`)).toThrow("Некорректный заголовок");
    }
  });

  test("writes normalized headings through Prettier without requiring fragments", async () => {
    let current = "# Changelog\n\n## 🚀[1.2.3] - 2022.08.24\n\n- Old entry.\n";
    fs.readFileSync.mockImplementation(() => current);
    fs.writeFileSync.mockImplementation((_filePath, content) => { current = content; });

    await expect(changelog.changelogWrite()).resolves.toBe(true);

    expect(current).toContain("## 🚀 [1.2.3] - 2022.08.24");
    expect(utils.execCommand).toHaveBeenCalledWith("npx --yes prettier --write CHANGELOG.md");
    expect(utils.execCommand).toHaveBeenCalledWith("npx --yes prettier --check CHANGELOG.md");
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  test("restores the original changelog if Prettier fails", async () => {
    const original = "# Changelog\n\n## 🚀[1.2.3] - 2022.08.24\n";
    let current = original;
    fs.readFileSync.mockImplementation(() => current);
    fs.writeFileSync.mockImplementation((_filePath, content) => { current = content; });
    utils.execCommand.mockImplementation((command) => !command.includes("--write"));

    await expect(changelog.changelogWrite()).resolves.toBe(false);

    expect(current).toBe(original);
    expect(fs.writeFileSync).toHaveBeenLastCalledWith("CHANGELOG.md", original);
  });

  test("does not write an invalid changelog", async () => {
    fs.readFileSync.mockReturnValue("# Changelog\n\n## [Unreleased]\n");

    await expect(changelog.changelogWrite()).resolves.toBe(false);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(utils.execCommand).not.toHaveBeenCalledWith(expect.stringContaining("--write"));
  });

});
