const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

jest.mock('../src/cli/run-action', () => ({
  runAction: jest.fn(),
  runAutomationAction: jest.fn()
}));
const { runAction, runAutomationAction } = require('../src/cli/run-action');
const { registerCommands } = require('../src/cli/commands');
const { configureHelp } = require('../src/cli/help');

function program() {
  const cli = new Command();
  registerCommands(cli);
  configureHelp(cli);
  return cli;
}
function leaves(command, prefix = []) {
  return command.commands.flatMap((child) => {
    const parts = [...prefix, child.name()];
    return child.commands.length ? leaves(child, parts) : [{ parts, command: child }];
  });
}
const commands = leaves(program());

beforeEach(() => jest.clearAllMocks());

test.each(commands.map(({ parts }) => [parts.join(' ')]))('%s accepts both no-verify flags', async (name) => {
  for (const flag of ['-n', '--no-verify', '-ns']) {
    const cli = program();
    const args = name.split(' ');
    if (name === 'changelog append') args.push('Example change');
    if (name === 'chart verify') args.push('/tmp/source');
    await cli.parseAsync([...args, flag], { from: 'user' });
    const calls = [...runAction.mock.calls, ...runAutomationAction.mock.calls];
    const command = calls.at(-1)[1];
    expect((typeof command.opts === 'function' ? command.opts() : command).verify).toBe(false);
    if (flag === '-ns') expect((typeof command.opts === 'function' ? command.opts() : command).silence).toBe(true);
  }
});

test('chart start keeps no-wait independent from no-verify', async () => {
  await program().parseAsync(['chart', 'start', '-n'], { from: 'user' });
  expect(runAction.mock.calls.at(-1)[1]).toMatchObject({ verify: false, wait: true });
  await program().parseAsync(['chart', 'start', '--no-wait'], { from: 'user' });
  expect(runAction.mock.calls.at(-1)[1]).toMatchObject({ verify: true, wait: false });
});

test('README inventory and help cover all registered actions', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const table = readme.split('Ниже перечислены все команды с действием')[1]
    .split('### 🛡️ Preflight-проверки по командам')[0];
  const documented = [...table.matchAll(/\| `spectrum ([^`]+)` \|/g)].map((match) => match[1]);
  expect(documented.sort()).toEqual(commands.map(({ parts }) => parts.join(' ')).sort());
  for (const { command } of commands) {
    expect(command.helpInformation()).toContain('-n, --no-verify');
    expect(command.helpInformation()).toContain('-d, --dry');
    expect(command.helpInformation()).toContain('-s, --silence');
  }
});
