/**
 * Command: mycode config
 * Manage providers, test connections, view configuration.
 */

import chalk from 'chalk';
import { ProviderRouter } from '../providers/router.js';
import {
  configExists,
  loadConfig,
  getProvidersSorted,
  removeProvider,
  CONFIG_FILE,
} from '../utils/config.js';
import { createSpinner } from '../ui/spinner.js';
import logger from '../utils/logger.js';

export function registerConfigCommand(program) {
  const config = program
    .command('config')
    .description('Manage providers and settings');

  // mycode config list
  config
    .command('list')
    .description('List all configured providers')
    .action(() => {
      if (!configExists()) {
        logger.error('No config found. Run `mycode init` first.');
        process.exit(1);
      }

      const cfg = loadConfig();
      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Configured Providers'));
      console.log(chalk.dim('  ───────────────────────'));

      if (cfg.providers.length === 0) {
        console.log(chalk.dim('  No providers configured. Run `mycode init` to add one.'));
      } else {
        for (const p of cfg.providers.sort((a, b) => a.priority - b.priority)) {
          const keyStatus = p.api_key
            ? chalk.hex('#34D399')('✓ key set')
            : (p.api_provider === 'ollama' ? chalk.dim('n/a') : chalk.hex('#F87171')('✗ no key'));

          console.log(
            `  ${chalk.hex('#A78BFA')(`#${p.priority}`)} ${chalk.bold(p.name)}`
          );
          console.log(
            `     ${chalk.dim('Provider:')} ${p.api_provider} | ${chalk.dim('Model:')} ${p.model}`
          );
          console.log(
            `     ${chalk.dim('URL:')} ${p.base_url} | ${keyStatus}`
          );
          console.log(
            `     ${p.read ? chalk.hex('#34D399')('✓ read') : chalk.dim('✗ read')} | ` +
            `${p.write ? chalk.hex('#34D399')('✓ write') : chalk.hex('#F87171')('✗ write')}`
          );
          console.log();
        }
      }

      console.log(chalk.dim(`  Config file: ${CONFIG_FILE}`));
      console.log();
    });

  // mycode config test
  config
    .command('test')
    .description('Test connectivity to all providers')
    .action(async () => {
      if (!configExists()) {
        logger.error('No config found. Run `mycode init` first.');
        process.exit(1);
      }

      const providers = getProvidersSorted();
      if (providers.length === 0) {
        logger.error('No providers configured.');
        process.exit(1);
      }

      console.log();
      console.log(chalk.hex('#A78BFA').bold('  Testing Provider Connections'));
      console.log(chalk.dim('  ─────────────────────────────'));
      console.log();

      try {
        const router = new ProviderRouter(providers);
        const results = await router.testAll();

        for (const result of results) {
          if (result.ok) {
            console.log(
              `  ${chalk.hex('#34D399')('✔')} ${chalk.bold(result.name)} ` +
              chalk.dim(`(${result.model})`) +
              chalk.hex('#34D399')(` — ${result.latencyMs}ms`)
            );
          } else {
            console.log(
              `  ${chalk.hex('#F87171')('✖')} ${chalk.bold(result.name)} ` +
              chalk.dim(`(${result.model})`) +
              chalk.hex('#F87171')(` — ${result.error}`)
            );
          }
        }
      } catch (err) {
        logger.error(err.message);
      }

      console.log();
    });

  // mycode config remove <name>
  config
    .command('remove <name>')
    .description('Remove a provider by name')
    .action((name) => {
      if (!configExists()) {
        logger.error('No config found. Run `mycode init` first.');
        process.exit(1);
      }

      const removed = removeProvider(name);
      if (removed) {
        logger.success(`Removed provider: ${name}`);
      } else {
        logger.error(`Provider not found: "${name}"`);
        const cfg = loadConfig();
        const names = cfg.providers.map((p) => p.name).join(', ');
        logger.info(`Available providers: ${names}`);
      }
    });

  // mycode config path
  config
    .command('path')
    .description('Show the config file path')
    .action(() => {
      console.log(CONFIG_FILE);
    });
}
