#!/usr/bin/env node

/**
 * MyCode CLI — Multi-Provider AI Coding Agent
 * Entry point for the global `mycode` command.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import commands
import { registerInitCommand } from '../src/commands/init.js';
import { registerChatCommand } from '../src/commands/chat.js';
import { registerExplainCommand } from '../src/commands/explain.js';
import { registerFixCommand } from '../src/commands/fix.js';
import { registerEditCommand } from '../src/commands/edit.js';
import { registerAgentCommand } from '../src/commands/agent.js';
import { registerConfigCommand } from '../src/commands/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('mycode')
  .description(chalk.bold('🚀 MyCode — Multi-Provider AI Coding Agent'))
  .version(pkg.version, '-v, --version', 'Display the current version')
  .addHelpText('beforeAll', `
${chalk.hex('#7C3AED').bold('╔══════════════════════════════════════════╗')}
${chalk.hex('#7C3AED').bold('║')}   ${chalk.hex('#A78BFA').bold('⚡ MyCode')} ${chalk.dim('— AI Coding in Your Terminal')}   ${chalk.hex('#7C3AED').bold('║')}
${chalk.hex('#7C3AED').bold('║')}   ${chalk.dim('Multi-provider • Auto-failover • Agent')}  ${chalk.hex('#7C3AED').bold('║')}
${chalk.hex('#7C3AED').bold('╚══════════════════════════════════════════╝')}
  `);

// Register all commands
registerInitCommand(program);
registerChatCommand(program);
registerExplainCommand(program);
registerFixCommand(program);
registerEditCommand(program);
registerAgentCommand(program);
registerConfigCommand(program);

// Default action (no command specified) — launch interactive chat
program.action(() => {
  program.help();
});

program.parse(process.argv);
