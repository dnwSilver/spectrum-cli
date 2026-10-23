jest.mock('../src/cli/run-action', () => ({ runAction: jest.fn() }));

const { Command } = require('commander');
const { registerCommands } = require('../src/cli/commands');
const { runAction } = require('../src/cli/run-action');
const { releaseStart } = require('../src/release');

test('release start forwards explicit stable and dry options to its action', async () => {
  const program = new Command();
  registerCommands(program);
  await program.parseAsync(['node', 'spectrum', 'release', 'start', '--stable', '--dry']);
  const [action, command] = runAction.mock.calls[0];
  expect(action).toBe(releaseStart);
  const options = typeof command.opts === 'function' ? command.opts() : command;
  expect(options).toMatchObject({ stable: true, dry: true });
});
