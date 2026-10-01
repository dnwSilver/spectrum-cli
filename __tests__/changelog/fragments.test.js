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

describe("changelog fragments", () => {
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

  test("formats messages without changing terminal punctuation", () => {
    expect(changelog.formatMessage("  Добавлена команда  ")).toBe("Добавлена команда.");
    expect(changelog.formatMessage("Исправлено!")).toBe("Исправлено!");
    expect(changelog.formatMessage("Почему?")).toBe("Почему?");
    expect(changelog.formatMessage("  ")).toBe("");
  });

  test("maps branch kinds to allowed sections", () => {
    utils.getCurrentBranch.mockReturnValue("support/SPEC-1-docs");
    expect(changelog.detectSectionFromBranch()).toEqual(["### 📦 Support", "### 🔐 Security"]);

    utils.getCurrentBranch.mockReturnValue("bugfix/SPEC-2-crash");
    expect(changelog.detectSectionFromBranch()).toEqual(["### 🪲 Fixed"]);

    utils.getCurrentBranch.mockReturnValue("feature/SPEC-3-api");
    expect(changelog.detectSectionFromBranch()).toEqual([
      "### 💥 Breaking change",
      "### 🆕 Added",
      "### 🛠 Changed",
      "### 📜 Deprecated",
      "### 🗑 Removed",
    ]);

    utils.getCurrentBranch.mockReturnValue("custom/SPEC-4-task");
    expect(changelog.detectSectionFromBranch()).toEqual([]);
  });

  test("extracts task IDs immediately after the GitFlow prefix", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-123-title");
    await expect(changelog.extractTaskFromBranch()).resolves.toBe("SPEC-123");

    utils.getCurrentBranch.mockReturnValue("bugfix/ABBVJSOP-1");
    await expect(changelog.extractTaskFromBranch()).resolves.toBe("ABBVJSOP-1");

    utils.getCurrentBranch.mockReturnValue("feature/SPEC-124-New-UI");
    await expect(changelog.extractTaskFromBranch()).resolves.toBe("SPEC-124");

    utils.getCurrentBranch.mockReturnValue(null);
    await expect(changelog.extractTaskFromBranch()).resolves.toBeNull();
  });

  test.each([
    "feature/spec-123-title",
    "feature/no-task",
    "AR-123-fix",
    "feature/fix-AR-123",
  ])("rejects a branch outside the GitFlow YouTrack contract: %s", async (branch) => {
    utils.getCurrentBranch.mockReturnValue(branch);
    await expect(changelog.extractTaskFromBranch()).resolves.toBeNull();
  });

  test("uses configured git identity or asks for missing values", async () => {
    await expect(changelog.getGitUser()).resolves.toBe("[Alex](alex@example.com)");

    utils.execSilent.mockReturnValue(null);
    mockQuestionAnswers(["Sam", "sam@example.com"]);
    await expect(changelog.getGitUser()).resolves.toBe("[Sam](sam@example.com)");

    mockQuestionAnswers(["", "unused@example.com"]);
    await expect(changelog.getGitUser()).resolves.toBeNull();
  });

  test("selects the only section and validates interactive choices", async () => {
    await expect(changelog.selectSection(["### 🪲 Fixed"])).resolves.toBe("### 🪲 Fixed");

    mockQuestionAnswers(["2"]);
    await expect(changelog.selectSection(["### 🆕 Added", "### 🛠 Changed"])).resolves.toBe("### 🛠 Changed");

    mockQuestionAnswers(["9"]);
    await expect(changelog.selectSection(["### 🆕 Added", "### 🛠 Changed"])).resolves.toBeNull();
  });

  test("builds portable fragment names and rejects lookalike extensions", () => {
    expect(changelog.sanitizeFragmentSlug("feature/SPEC-8-New UI", "SPEC-8")).toBe("feature-new-ui");
    expect(changelog.createFragmentPath("SPEC-8", "added", "feature/SPEC-8-New UI")).toBe(
      ".changelog/SPEC-8-feature-new-ui.added.md"
    );
    expect(getFragmentType(".changelog/SPEC-8-feature.added.md")).toBe("added");
    expect(getFragmentType(".changelog/SPEC-8-featureXaddedYmd")).toBeNull();
  });

  test("creates a fragment instead of editing CHANGELOG.md", async () => {
    mockQuestionAnswers(["2"]);

    await expect(changelog.changelogAppend("Добавлен новый экран")).resolves.toBe(true);

    expect(fs.mkdirSync).toHaveBeenCalledWith(".changelog", { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      ".changelog/SPEC-8-feature-new-ui.added.md",
      "- SPEC-8 Добавлен новый экран. [Alex](alex@example.com)\n"
    );
    expect(fs.writeFileSync).not.toHaveBeenCalledWith("CHANGELOG.md", expect.any(String));
  });

  test("appends unique entries to an existing fragment", () => {
    const fragmentPath = ".changelog/SPEC-8-feature-new-ui.added.md";
    fs.existsSync.mockImplementation((filePath) => filePath === "CHANGELOG.md" || filePath === fragmentPath);
    fs.readFileSync.mockReturnValue("- SPEC-8 Первая запись. [Alex](alex@example.com)\n");
    const context = {
      fragmentState: {
        fragmentPath,
        entry: "- SPEC-8 Вторая запись. [Alex](alex@example.com)",
        selectedSection: "### 🆕 Added",
      },
    };

    expect(changelog.appendPreparedChangelogEntry(context)).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      fragmentPath,
      "- SPEC-8 Первая запись. [Alex](alex@example.com)\n- SPEC-8 Вторая запись. [Alex](alex@example.com)\n"
    );

    fs.writeFileSync.mockClear();
    context.fragmentState.entry = "- SPEC-8 Первая запись. [Alex](alex@example.com)";
    expect(changelog.appendPreparedChangelogEntry(context)).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      fragmentPath,
      "- SPEC-8 Первая запись. [Alex](alex@example.com)\n"
    );
  });

  test("rejects malformed existing fragments and write failures", () => {
    const fragmentPath = ".changelog/SPEC-8-feature-new-ui.added.md";
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("invalid line\n");
    const context = {
      fragmentState: {
        fragmentPath,
        entry: "- SPEC-8 Entry. [Alex](alex@example.com)",
        selectedSection: "### 🆕 Added",
      },
    };

    expect(changelog.appendPreparedChangelogEntry(context)).toBe(false);

    fs.readFileSync.mockReturnValue("");
    fs.writeFileSync.mockImplementation(() => {
      throw new Error("write failed");
    });
    expect(changelog.appendPreparedChangelogEntry(context)).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("❌", "Ошибка при записи changelog fragment: %s", "write failed");
  });

  test("validates CHANGELOG.md and fragments with changelog check", async () => {
    fs.existsSync.mockImplementation((filePath) => ["CHANGELOG.md", ".changelog"].includes(filePath));
    fs.readdirSync.mockReturnValue([
      { name: "SPEC-8-feature.added.md", isFile: () => true },
    ]);
    fs.readFileSync.mockReturnValue("- SPEC-8 Добавлен экран. [Alex](alex@example.com)\n");

    await expect(changelog.changelogCheck()).resolves.toBe(true);
    expect(utils.execCommand).toHaveBeenCalledWith("npx --yes prettier --check CHANGELOG.md");

    fs.readFileSync.mockReturnValue("invalid\n");
    await expect(changelog.changelogCheck()).resolves.toBe(false);
  });

});
