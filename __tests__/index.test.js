#!/usr/bin/env node
const mockRelease = { releaseStart: jest.fn(), releaseClose: jest.fn() };
const mockGit = { gitCreateTagAndPush: jest.fn() };
const mockChangelog = { changelogAppend: jest.fn(), changelogCheck: jest.fn(), changelogWrite: jest.fn() };
const mockChart = { chartStart: jest.fn(), chartVerify: jest.fn(), chartDeploy: jest.fn() };
const mockToken = { tokenRotate: jest.fn() };
const mockHotfix = { hotfixStart: jest.fn(), hotfixDeploy: jest.fn(), hotfixClose: jest.fn() };
const mockUpdate = { checkForUpdates: jest.fn(), upgrade: jest.fn() };

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
    this._allowExcessArguments = true;
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

  requiredOption(definition, description) {
    this._options.push({ definition, description, required: true });
    return this;
  }

  option(definition, description) {
    this._options.push({ definition, description, required: false });
    return this;
  }

  allowExcessArguments(allow) {
    this._allowExcessArguments = allow;
    return this;
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
jest.mock("../src/changelog", () => mockChangelog);
jest.mock("../src/chart", () => mockChart);
jest.mock("../src/token", () => mockToken);
jest.mock("../src/hotfix", () => mockHotfix);
jest.mock("../src/update-check", () => mockUpdate);
jest.mock("../package.json", () => ({ version: "9.9.9" }), { virtual: true });

describe("index CLI wiring", () => {
  const originalExit = process.exit;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockUpdate.checkForUpdates.mockResolvedValue(undefined);
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

  test("every action has short dry and silence flags", () => {
    const actions = [];
    const collect = (command) => {
      if (command._action) actions.push(command);
      command._commands.forEach(collect);
    };
    collect(mockState.root);
    expect(actions).toHaveLength(14);
    for (const command of actions) {
      expect(command._options.map((option) => option.definition)).toContain("-d, --dry");
      expect(command._options.map((option) => option.definition)).toContain("-s, --silence");
    }
  });

  test("dry option from Commander opts skips the update check and reaches the handler", async () => {
    const releaseCmd = mockState.root._commands.find((c) => c._name === "release");
    mockRelease.releaseStart.mockImplementation(() => {
      expect(require('../src/command-executor').isDryRun()).toBe(true);
      return true;
    });
    await releaseCmd._commands.find((c) => c._name === 'start')._action({ opts: () => ({ dry: true }) });
    expect(mockRelease.releaseStart).toHaveBeenCalledWith({ dry: true });
    expect(mockUpdate.checkForUpdates).not.toHaveBeenCalled();
  });

  test("silence from Commander opts hides successful preflight output", async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockRelease.releaseStart.mockImplementation(() => {
        require('../src/command-executor').reportPreflight('release start', 'git-repo');
        return true;
      });
      const releaseCmd = mockState.root._commands.find((c) => c._name === 'release');
      await releaseCmd._commands.find((c) => c._name === 'start')
        ._action({ opts: () => ({ dry: true, silence: true }) });

      expect(mockRelease.releaseStart).toHaveBeenCalledWith({ dry: true, silence: true });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("release commands check for updates and call target handlers", async () => {
    const releaseCmd = mockState.root._commands.find((c) => c._name === "release");
    const start = releaseCmd._commands.find((c) => c._name === "start");
    const close = releaseCmd._commands.find((c) => c._name === "close");
    const deploy = releaseCmd._commands.find((c) => c._name === "deploy");

    expect(start._options.map((o) => o.definition)).toEqual(["-d, --dry", "-s, --silence"]);
    await start._action();
    await close._action();
    await deploy._action();

    expect(mockUpdate.checkForUpdates).toHaveBeenCalledTimes(3);
    expect(mockRelease.releaseStart).toHaveBeenCalledWith({});
    expect(mockRelease.releaseClose).toHaveBeenCalled();
    expect(mockGit.gitCreateTagAndPush).toHaveBeenCalled();
  });

  test("version up command group is removed", () => {
    const versionCmd = mockState.root._commands.find((c) => c._name === "version");
    expect(versionCmd).toBeUndefined();
  });

  test("upgrade checks for updates and invokes the npm installer", async () => {
    mockUpdate.upgrade.mockReturnValue(true);
    const upgrade = mockState.root._commands.find((c) => c._name === "upgrade");

    await upgrade._action();

    expect(mockUpdate.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(mockUpdate.upgrade).toHaveBeenCalledWith({});
    expect(process.exit).not.toHaveBeenCalled();
  });

  test.each([['start', 'hotfixStart'], ['deploy', 'hotfixDeploy'], ['close', 'hotfixClose']])(
    'hotfix %s calls its handler', async (command, handler) => {
      mockHotfix[handler].mockReturnValue(true);
      const group = mockState.root._commands.find((c) => c._name === 'hotfix');
      await group._commands.find((c) => c._name === command)._action();
      expect(mockUpdate.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(mockHotfix[handler]).toHaveBeenCalledWith({});
      expect(process.exit).not.toHaveBeenCalled();
    }
  );

  test("an update check error does not block the command or print an error", async () => {
    mockUpdate.checkForUpdates.mockRejectedValue(new Error("registry unavailable"));
    mockHotfix.hotfixStart.mockReturnValue(true);
    const group = mockState.root._commands.find((c) => c._name === "hotfix");

    await group._commands.find((c) => c._name === "start")._action();

    expect(mockHotfix.hotfixStart).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("chart start command calls chart tag creation", async () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const start = chartCmd._commands.find((c) => c._name === "start");

    await start._action({ force: true, wait: true });

    expect(mockChart.chartStart).toHaveBeenCalledWith({ force: true, wait: true });
    expect(start._options.map((o) => o.definition)).toEqual(["-f, --force", "-n, --no-wait", "-d, --dry", "-s, --silence"]);
    expect(start._allowExcessArguments).toBe(false);
    expect(chartCmd._commands.some((c) => c._name === "create")).toBe(false);
  });

  test("chart start forwards negated wait and dry options", async () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    mockChart.chartStart.mockReturnValue(true);
    await chartCmd._commands.find((c) => c._name === "start")
      ._action({ opts: () => ({ wait: false, dry: true }) });
    expect(mockChart.chartStart).toHaveBeenCalledWith({ wait: false, dry: true });
    expect(mockUpdate.checkForUpdates).not.toHaveBeenCalled();
  });

  test("chart verify command calls chart verify handler", async () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const verify = chartCmd._commands.find((c) => c._name === "verify");

    await verify._action("/tmp/source");

    expect(mockChart.chartVerify).toHaveBeenCalledWith("/tmp/source");
  });

  test("token rotate command calls token rotate handler", async () => {
    const tokenCmd = mockState.root._commands.find((c) => c._name === "token");
    const rotate = tokenCmd._commands.find((c) => c._name === "rotate");

    await rotate._action();

    expect(mockToken.tokenRotate).toHaveBeenCalled();
  });

  test("chart deploy command calls chart deploy handler", async () => {
    const chartCmd = mockState.root._commands.find((c) => c._name === "chart");
    const deploy = chartCmd._commands.find((c) => c._name === "deploy");

    await deploy._action({ instances: "sd,cbch" });

    expect(mockChart.chartDeploy).toHaveBeenCalledWith({ instances: "sd,cbch" });
    expect(deploy._options.map((o) => o.definition)).toEqual(["-i, --instances <names>", "-d, --dry", "-s, --silence"]);
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

    expect(console.error).toHaveBeenCalledWith("❌ Ошибка: boom");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("changelog check command calls fragment validation", async () => {
    mockChangelog.changelogCheck.mockResolvedValue(true);
    const changelogCmd = mockState.root._commands.find((c) => c._name === "changelog");
    const check = changelogCmd._commands.find((c) => c._name === "check");

    await check._action();

    expect(mockChangelog.changelogCheck).toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("changelog write command calls the formatter", async () => {
    mockChangelog.changelogWrite.mockResolvedValue(true);
    const changelogCmd = mockState.root._commands.find((c) => c._name === "changelog");
    const write = changelogCmd._commands.find((c) => c._name === "write");

    await write._action();

    expect(mockUpdate.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(mockChangelog.changelogWrite).toHaveBeenCalledWith({});
    expect(process.exit).not.toHaveBeenCalled();
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

    expect(text).toContain("Использование: spectrum <command>");
    expect(text).toContain("Команды:");
    expect(text).toContain("Опции:");
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
    expect(text).toContain("Использование: spectrum");
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
    expect(text).toContain("Использование: spectrum chart");
    expect(text).toContain("chart commands");
    expect(text).toContain("deploy");
    expect(text).toContain("deploy chart");
  });
});
