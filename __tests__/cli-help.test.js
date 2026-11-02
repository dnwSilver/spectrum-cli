const { configureHelp } = require("../src/cli/help");

let formatHelp;
beforeEach(() => {
  configureHelp({ configureHelp: (config) => { formatHelp = config.formatHelp; } });
});

describe("CLI help formatter", () => {
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

    const text = formatHelp({}, helper);

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

    const text = formatHelp({}, helper);
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

    const text = formatHelp({}, helper);
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

    const text = formatHelp({}, helper);
    expect(text).toContain("Использование: spectrum chart");
    expect(text).toContain("chart commands");
    expect(text).toContain("deploy");
    expect(text).toContain("deploy chart");
  });
});
