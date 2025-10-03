#!/usr/bin/env node
const { Command } = require("commander");
const program = new Command();

const git = require("./src/git");
const version = require("./src/version");
const release = require("./src/release");
const changelog = require("./src/changelog");
const { version: pkgVersion } = require("./package.json");

program
  .name("spectrum")
  .description("🚀 Spectrum CLI for development workflow")
  .version(pkgVersion, "-v, --version");

// Release commands
const releaseCmd = program
  .command("release")
  .description("Release management commands");

releaseCmd
  .command("start")
  .description("Start full release process")
  .action(() => release.releaseStart());

releaseCmd
  .command("close")
  .description("Close release and merge to dev")
  .action(() => release.releaseClose());

releaseCmd
  .command("deploy")
  .description("Deploy release (create and push tag)")
  .action(() => git.gitCreateTagAndPush());

// Version up commands
const versionCmd = program
  .command("version")
  .description("Update version using semantic versioning");

const upCmd = versionCmd
  .command("up")
  .description("Update version using semantic versioning");

upCmd
  .command("major")
  .description("Bump major version (x.0.0)")
  .action(() => version.setVersionTypescript("major"));

upCmd
  .command("minor")
  .description("Bump minor version (x.y.0)")
  .action(() => version.setVersionTypescript("minor"));

upCmd
  .command("patch")
  .description("Bump patch version (x.y.z)")
  .action(() => version.setVersionTypescript("patch"));

// Changelog commands
const changelogCmd = program
  .command("changelog")
  .description("Changelog management commands");

changelogCmd
  .command("append <message>")
  .description("Append entry to changelog with task number from branch")
  .action(async (message) => {
    try {
      await changelog.changelogAppend(message);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Override help to show custom format with aliases
program.configureHelp({
  formatHelp: (cmd, helper) => {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth || 80;
    const itemIndentWidth = 2;
    const itemSeparatorWidth = 2;
    const cmdUsage = helper.commandUsage(cmd);
    const cmdDescription = helper.commandDescription(cmd);
    const options = helper.visibleOptions(cmd);
    const commands = helper.visibleCommands(cmd);

    let output = "";

    // Usage
    if (cmdUsage) {
      output += `Usage: ${cmdUsage}\n\n`;
    }

    // Description
    if (cmdDescription) {
      output += `${cmdDescription}\n\n`;
    }

    // Commands with aliases
    if (commands.length > 0) {
      output += "Commands:\n";
      commands.forEach((cmd) => {
        const nameAndArgs = cmd.name() + cmd.usage().replace(/^[^\s]+\s*/, " ");
        const aliases = cmd.aliases();
        const description = cmd.description();

        let cmdLine = `  ${nameAndArgs}`;
        if (aliases.length > 0) {
          cmdLine = cmdLine.padEnd(25) + `[${aliases.join(", ")}]`;
        }
        cmdLine = cmdLine.padEnd(40) + description;
        output += cmdLine + "\n";
      });
      output += "\n";
    }

    // Options
    if (options.length > 0) {
      output += "Options:\n";
      options.forEach((option) => {
        const flags = helper.optionTerm(option);
        const description = helper.optionDescription(option);
        output += `  ${flags.padEnd(25)} ${description}\n`;
      });
    }

    return output;
  },
});

program.parse();
