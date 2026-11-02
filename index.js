#!/usr/bin/env node
const { Command } = require('commander');
const { registerCommands } = require('./src/cli/commands');
const { configureHelp } = require('./src/cli/help');

const program = new Command();
registerCommands(program);
configureHelp(program);
program.parse();
