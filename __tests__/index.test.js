#!/usr/bin/env node
const mockRelease = { releaseStart: jest.fn(), releaseClose: jest.fn() };
const mockGit = { gitCreateTagAndPush: jest.fn() };
const mockVersion = { setVersion: jest.fn() };
const mockChangelog = { changelogAppend: jest.fn() };
const mockChart = { chartCreateTag: jest.fn(), chartVerify: jest.fn(), chartDeploy: jest.fn() };

const mockState = {
  root: null,
  helpConfig: null,
};

class MockCommand {
  constructor(name = "") {
    this._name = name;
    this._description = "";
    this._usage = name;
    this._aliases = [];
    this._commands = [];
    this._options = [];
    this._action = null;
    this._parse = jest.fn();
  }

  name(value) {
    if (value === undefined) return this._name;
    this._name = value;
    return this;
  }

  description(value) {
    if (value === undefined) return this._description;
    this._description = value;
    return this;
  }

  version() {
    return this;
  }

  command(definition) {
    const child = new MockCommand(definition.split(" ")[0]);
    child._usage = definition;
    this._commands.push(child);
    return child;
  }

  usage() {
    return this._usage;
  }

  aliases() {
    return this._aliases;
  }

  action(fn) {
    this._action = fn;
    return this;
  }

  configureHelp(config) {
    mockState.helpConfig = config;
    return this;
  }

  parse() {
    this._parse();
    return this;
  }
}

jest.mock("commander", () => ({
  Command: jest.fn(() => {
    mockState.root = new MockCommand("spectrum");
    return mockState.root;
  }),
}));

jest.mock("../src/release", () => mockRelease);
jest.mock("../src/git", () => mockGit);
jest.mock("../src/version", () => mockVersion);
jest.mock("../src/changelog", () => mockChangelog);
jest.mock("../src/chart", () => mockChart);
jest.mock("../package.json", () => ({ version: "9.9.9" }), { virtual: true });

describe("index CLI wiring", () => {
  const originalExit = process.exit;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.exit = jest.fn();
    console.error = jest.fn();
    require("../index.js");
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalError;
  });

  test("calls parse on root command", () => {
    expect(mockState.root._parse).toHaveBeenCalled();
  });

  test("release commands call target handlers", () => {
    const releaseCmd = mockState.root._commands.find((c) => c._name === "release");
    const start = releaseCmd._commands.find((c) => c._name === "start");
    const close = releaseCmd._commands.find((c) => c._name === "close");
    const deploy = releaseCmd._commands.find((c) => c._name === "deploy");

    start._action();
    close._action();
    deploy._action();

    expect(mockRelease.releaseStart).toHaveBeenCalled();
    expect(mockRelease.releaseClose).toHaveBeenCalled();
    expect(mockGit.gitCreateTagAndPush).toHaveBeenCalled();
  });

  test("version up commands call setVersion with expected type", () => {
    const versionCmd = mockState.root._commands.find((c) => c._name === "version");
    const up = versionCmd._commands.find((c) => c._name === "up");

    up._commands.find((c) => c._name === "major")._action();
    up._commands.find((c) => c._name === "minor")._action();
    up._commands.find((c) => c._name === "patch")._action();

    expect(mockVersion.setVersion).toHaveBeenNthCalledWith(1, "major");
    expect(mockVersion.setVersion).toHaveBeenNthCalledWith(2, "minor");
    expect(mockVersion.setVersion).toHaveBeenNthCalledWith(3, "patch");
  });

  test("chart create command calls chart tag creation", () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const create = chartCmd._commands.find((c) => c._name === "create");

    create._action("1.2.3");

    expect(mockChart.chartCreateTag).toHaveBeenCalledWith("1.2.3");
  });

  test("chart verify command calls chart verify handler", () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const verify = chartCmd._commands.find((c) => c._name === "verify");

    verify._action("/tmp/source");

    expect(mockChart.chartVerify).toHaveBeenCalledWith("/tmp/source");
  });

  test("chart deploy command calls chart deploy handler", () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const deploy = chartCmd._commands.find((c) => c._name === "deploy");

    deploy._action();

    expect(mockChart.chartDeploy).toHaveBeenCalled();
  });

  test("changelog append command handles success", async () => {
    mockChangelog.changelogAppend.mockResolvedValue(true);
    const changelogCmd = mockState.root._commands.find((c) => c._name === "changelog");
    const append = changelogCmd._commands.find((c) => c._name === "append");

    await append._action("Message");

    expect(mockChangelog.changelogAppend).toHaveBeenCalledWith("Message");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("changelog append command handles failure", async () => {
    mockChangelog.changelogAppend.mockRejectedValue(new Error("boom"));
    const changelogCmd = mockState.root._commands.find((c) => c._name === "changelog");
    const append = changelogCmd._commands.find((c) => c._name === "append");

    await append._action("Message");

    expect(console.error).toHaveBeenCalledWith("❌ Error: boom");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("custom help formatter renders sections", () => {
    const helper = {
      padWidth: () => 10,
      helpWidth: 80,
      commandUsage: () => "spectrum <command>",
      commandDescription: () => "desc",
      visibleOptions: () => [
        {
          flags: "-v, --version",
          description: "show version",
        },
      ],
      visibleCommands: () => [
        {
          name: () => "release",
          usage: () => "release start",
          aliases: () => ["r"],
          description: () => "release management",
        },
      ],
      optionTerm: (o) => o.flags,
      optionDescription: (o) => o.description,
    };

    const text = mockState.helpConfig.formatHelp(mockState.root, helper);

    expect(text).toContain("Usage: spectrum <command>");
    expect(text).toContain("Commands:");
    expect(text).toContain("Options:");
    expect(text).toContain("[r]");
  });

  test("custom help formatter handles empty sections", () => {
    const helper = {
      padWidth: () => 10,
      helpWidth: 80,
      commandUsage: () => "",
      commandDescription: () => "",
      visibleOptions: () => [],
      visibleCommands: () => [],
      optionTerm: (o) => o.flags,
      optionDescription: (o) => o.description,
    };

    const text = mockState.helpConfig.formatHelp(mockState.root, helper);
    expect(text).toBe("");
  });

  test("custom help formatter falls back to default helpWidth", () => {
    const helper = {
      padWidth: () => 10,
      commandUsage: () => "spectrum",
      commandDescription: () => "desc",
      visibleOptions: () => [],
      visibleCommands: () => [],
      optionTerm: (o) => o.flags,
      optionDescription: (o) => o.description,
    };

    const text = mockState.helpConfig.formatHelp(mockState.root, helper);
    expect(text).toContain("Usage: spectrum");
  });

  test("custom help formatter renders command without aliases", () => {
    const helper = {
      padWidth: () => 10,
      helpWidth: 80,
      commandUsage: () => "spectrum chart",
      commandDescription: () => "chart commands",
      visibleOptions: () => [],
      visibleCommands: () => [
        {
          name: () => "deploy",
          usage: () => "deploy",
          aliases: () => [],
          description: () => "deploy chart",
        },
      ],
      optionTerm: (o) => o.flags,
      optionDescription: (o) => o.description,
    };

    const text = mockState.helpConfig.formatHelp(mockState.root, helper);
    expect(text).toContain("Usage: spectrum chart");
    expect(text).toContain("chart commands");
    expect(text).toContain("deploy");
    expect(text).toContain("deploy chart");
  });
});
