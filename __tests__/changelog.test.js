#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");

jest.mock("fs");
jest.mock("readline");
jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
  execCommand: jest.fn(),
  execSilent: jest.fn(),
  getVersion: jest.fn(),
  getCurrentBranch: jest.fn(),
  colors: {
    yellow: "<y>",
    green: "<g>",
    reset: "<r>",
  },
}));

const utils = require("../src/utils");
const changelog = require("../src/changelog");

describe("changelog", () => {
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "prettier --version") return null;
      return null;
    });
    utils.execCommand.mockImplementation((command) => {
      if (command.includes("--check CHANGELOG.md")) return true;
      return true;
    });
  });

  afterAll(() => {
    console.log = originalLog;
  });

  function mockQuestionAnswers(answers) {
    let i = 0;
    readline.createInterface.mockImplementation(() => ({
      question: (_q, cb) => cb(answers[i++]),
      close: jest.fn(),
    }));
  }

  test("formatMessage appends dot when needed", () => {
    expect(changelog.formatMessage("Hello")).toBe("Hello.");
    expect(changelog.formatMessage("Hello.")).toBe("Hello.");
  });

  test("detectSectionFromBranch returns mapped sections", () => {
    utils.getCurrentBranch.mockReturnValue("support/SPEC-1");
    expect(changelog.detectSectionFromBranch()).toEqual(["### 📦 Support", "### 🔐 Security"]);

    utils.getCurrentBranch.mockReturnValue("bugfix/SPEC-1");
    expect(changelog.detectSectionFromBranch()).toEqual(["### 🪲 Fixed"]);

    utils.getCurrentBranch.mockReturnValue("feature/SPEC-1");
    expect(changelog.detectSectionFromBranch()).toEqual([
      "### 🆕 Added",
      "### 🛠 Changed",
      "### 📜 Deprecated",
      "### 🗑 Removed",
    ]);

    utils.getCurrentBranch.mockReturnValue("random/SPEC-1");
    expect(changelog.detectSectionFromBranch()).toEqual([]);
  });

  test("detectSectionFromBranch returns empty when branch missing", () => {
    utils.getCurrentBranch.mockReturnValue(null);
    expect(changelog.detectSectionFromBranch()).toEqual([]);
  });

  test("extractTaskFromBranch returns null when branch missing", async () => {
    utils.getCurrentBranch.mockReturnValue(null);
    expect(await changelog.extractTaskFromBranch()).toBeNull();
    expect(utils.logError).toHaveBeenCalledWith("❌", "Cannot get current branch name.");
  });

  test("extractTaskFromBranch returns task from branch", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-123-description");
    expect(await changelog.extractTaskFromBranch()).toBe("SPEC-123");
  });

  test("extractTaskFromBranch asks user and validates task", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/no-ticket");
    mockQuestionAnswers(["SPEC-456"]);
    expect(await changelog.extractTaskFromBranch()).toBe("SPEC-456");
  });

  test("extractTaskFromBranch returns null for invalid entered task", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/no-ticket");
    mockQuestionAnswers(["invalid"]);
    expect(await changelog.extractTaskFromBranch()).toBeNull();
    expect(utils.logError).toHaveBeenCalledWith(
      "❌",
      "Invalid task format. Expected format: [a-zA-Z]+-[0-9]+"
    );
  });

  test("getGitUser returns configured user", async () => {
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "a@b.com";
      return null;
    });

    expect(await changelog.getGitUser()).toBe("[Alex](a@b.com)");
  });

  test("getGitUser asks for missing values and validates", async () => {
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "";
      if (command === "git config user.email") return "";
      return null;
    });
    mockQuestionAnswers(["Alex", "alex@example.com"]);

    expect(await changelog.getGitUser()).toBe("[Alex](alex@example.com)");
  });

  test("getGitUser fails on empty name", async () => {
    utils.execSilent.mockImplementation((command) => {
      if (command === "git config user.name") return "";
      if (command === "git config user.email") return "ok@example.com";
      return "3.0.0";
    });
    mockQuestionAnswers([""]);

    expect(await changelog.getGitUser()).toBeNull();
    expect(utils.logError).toHaveBeenCalledWith("❌", "Name is required.");
  });

  test("getGitUser fails on invalid email", async () => {
    utils.execSilent.mockImplementation((command) => {
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "";
      return "3.0.0";
    });
    mockQuestionAnswers(["invalid-email"]);

    expect(await changelog.getGitUser()).toBeNull();
    expect(utils.logError).toHaveBeenCalledWith("❌", "Valid email is required.");
  });

  test("selectSection returns only section if one exists", async () => {
    expect(await changelog.selectSection(["### 🪲 Fixed"])).toBe("### 🪲 Fixed");
  });

  test("selectSection returns selected from default list", async () => {
    mockQuestionAnswers(["2"]);
    expect(await changelog.selectSection([])).toBe("### 🛠 Changed");
  });

  test("selectSection returns null for invalid selection", async () => {
    mockQuestionAnswers(["99"]);
    expect(await changelog.selectSection(["### 🪲 Fixed", "### 📦 Support"])).toBeNull();
    expect(utils.logError).toHaveBeenCalledWith("❌", "Invalid choice.");
  });

  test("changelogChangeHeader success", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    fs.readFileSync.mockReturnValue("## [Unreleased]\n");
    fs.writeFileSync.mockImplementation(() => {});

    expect(changelog.changelogChangeHeader()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith("CHANGELOG.md", "## 🚀 [1.2.3]\n");
  });

  test("changelogChangeHeader returns false on missing version", () => {
    utils.getVersion.mockReturnValue(null);
    expect(changelog.changelogChangeHeader()).toBe(false);
  });

  test("changelogChangeHeader catches read error", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    fs.readFileSync.mockImplementation(() => {
      throw new Error("read");
    });
    expect(changelog.changelogChangeHeader()).toBe(false);
  });

  test("changelogChangeHeader returns false on prettier missing", () => {
    utils.execSilent.mockReturnValue(null);
    expect(changelog.changelogChangeHeader()).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("❌", "Prettier is not available. Install it or use npx.");
  });

  test("changelogRemoveEmptyChapters success", () => {
    fs.readFileSync.mockReturnValue("### A\n\n_x_\n\n### B\n\n_y_\n\n");
    fs.writeFileSync.mockImplementation(() => {});

    expect(changelog.changelogRemoveEmptyChapters()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith("CHANGELOG.md", "");
  });

  test("changelogRemoveEmptyChapters catches read errors", () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(changelog.changelogRemoveEmptyChapters()).toBe(false);
  });

  test("changelogRemoveEmptyChapters returns false on prettier check fail", () => {
    utils.execCommand.mockImplementation((command) => (command.includes("--check") ? false : true));
    expect(changelog.changelogRemoveEmptyChapters()).toBe(false);
  });

  test("changelogAddUnreleasedBlock success", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    fs.readFileSync
      .mockReturnValueOnce("## [Unreleased]\n")
      .mockReturnValueOnce("## 🚀 [1.2.3]\n");

    expect(changelog.changelogAddUnreleasedBlock()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "CHANGELOG.md",
      "## [Unreleased]\n\n## 🚀 [1.2.3]\n"
    );
  });

  test("changelogAddUnreleasedBlock returns false on missing version", () => {
    utils.getVersion.mockReturnValue(null);
    expect(changelog.changelogAddUnreleasedBlock()).toBe(false);
  });

  test("changelogAddUnreleasedBlock returns false on prettier check fail", () => {
    utils.execCommand.mockImplementation((command) => (command.includes("--check") ? false : true));
    expect(changelog.changelogAddUnreleasedBlock()).toBe(false);
  });

  test("changelogAddUnreleasedBlock catches read errors", () => {
    utils.getVersion.mockReturnValue("1.2.3");
    fs.readFileSync.mockImplementation(() => {
      throw new Error("read");
    });
    expect(changelog.changelogAddUnreleasedBlock()).toBe(false);
  });

  test("changelogCommit success and failure", () => {
    utils.execCommand.mockReturnValueOnce(true).mockReturnValueOnce(true);
    expect(changelog.changelogCommit()).toBe(true);
    expect(utils.logSuccess).toHaveBeenCalledWith("📝", "Commit updated changelog.");

    utils.execCommand.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(changelog.changelogCommit()).toBe(false);
  });

  test("changelogAppend returns false on prettier check fail", async () => {
    utils.execCommand.mockImplementation((command) => command.includes("--check") ? false : true);
    expect(await changelog.changelogAppend("Message")).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith(
      "❌",
      "CHANGELOG.md failed Prettier check. Fix formatting before proceeding."
    );
  });

  test("changelogAppend returns false when no section in changelog", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-7");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    fs.readFileSync.mockReturnValue("## [Unreleased]\n");
    mockQuestionAnswers(["1"]);

    expect(await changelog.changelogAppend("Add feature")).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith(
      "❌",
      'Cannot find "%s" section in CHANGELOG.md.',
      "### 🆕 Added"
    );
  });

  test("changelogAppend success and removes default text", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-8");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    const content = [
      "## [Unreleased]",
      "",
      "### 🆕 Added",
      "",
      "_Список новой функциональности._",
      "",
      "### 🛠 Changed",
      "",
      "_Список изменившейся функциональности._",
    ].join("\n");
    fs.readFileSync.mockReturnValue(content);
    fs.writeFileSync.mockImplementation(() => {});
    mockQuestionAnswers(["1"]);

    expect(await changelog.changelogAppend("Something happened")).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "CHANGELOG.md",
      expect.stringContaining("- SPEC-8 Something happened. [Alex](alex@example.com)")
    );
  });

  test("changelogAppend keeps default text when section already has entries", async () => {
    utils.getCurrentBranch.mockReturnValue("feature/SPEC-9");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    const content = [
      "## [Unreleased]",
      "",
      "### 🆕 Added",
      "",
      "_Список новой функциональности._",
      "- SPEC-1 Existing. [User](mail@example.com)",
    ].join("\n");
    fs.readFileSync.mockReturnValue(content);
    fs.writeFileSync.mockImplementation(() => {});
    mockQuestionAnswers(["1"]);

    expect(await changelog.changelogAppend("Another one")).toBe(true);
    const written = fs.writeFileSync.mock.calls[0][1];
    expect(written).not.toContain("_Список новой функциональности._");
    expect(written).toContain("- SPEC-1 Existing. [User](mail@example.com)");
  });

  test("changelogAppend handles thrown error", async () => {
    utils.getCurrentBranch.mockReturnValue("bugfix/SPEC-11");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    fs.readFileSync.mockImplementation(() => {
      throw new Error("read failed");
    });

    expect(await changelog.changelogAppend("oops")).toBe(false);
    expect(utils.logError).toHaveBeenCalledWith("❌", "Error adding changelog entry: %s", "read failed");
  });

  test("changelogAppend covers hasOtherEntries branch", async () => {
    const originalStartsWith = String.prototype.startsWith;
    String.prototype.startsWith = function startsWithMock(prefix, ...rest) {
      if (this.toString() === "_MAGIC_") {
        if (prefix === "_") return true;
        if (prefix === "- ") return true;
      }
      return originalStartsWith.call(this, prefix, ...rest);
    };

    utils.getCurrentBranch.mockReturnValue("feature/SPEC-15");
    utils.execSilent.mockImplementation((command) => {
      if (command === "npx --yes prettier --version") return "3.0.0";
      if (command === "git config user.name") return "Alex";
      if (command === "git config user.email") return "alex@example.com";
      return null;
    });
    fs.readFileSync.mockReturnValue(["## [Unreleased]", "", "### 🆕 Added", "", "_MAGIC_"].join("\n"));
    fs.writeFileSync.mockImplementation(() => {});
    mockQuestionAnswers(["1"]);

    expect(await changelog.changelogAppend("Edge path")).toBe(true);

    String.prototype.startsWith = originalStartsWith;
  });
});
