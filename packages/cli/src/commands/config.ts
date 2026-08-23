import { ConfigManager, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';

export async function configCommand(sub?: string, ...args: string[]): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (!sub || sub === 'list') {
    console.log(chalk.cyan('MyCode Configuration\n'));
    console.log(chalk.bold('Path:'), config.getConfigPath());
    console.log(chalk.bold('Providers:'), cfg.providers.length);

    if (cfg.providers.length > 0) {
      console.log('');
      for (const p of cfg.providers) {
        const status = chalk.green('active');
        console.log(`  ${chalk.bold(p.name)} (${p.apiProvider})`);
        console.log(`    Model: ${p.model}  Status: ${status}`);
        console.log('');
      }
    }
    return;
  }

  if (sub === 'remove' && args.length > 0) {
    const name = args[0];
    const removed = await config.removeProvider(name);
    if (removed) {
      console.log(chalk.green(`Removed provider: ${name}`));
    } else {
      console.log(chalk.yellow(`Provider not found: ${name}`));
    }
    return;
  }

  if (sub === 'test') {
    console.log(chalk.cyan('Testing providers...\n'));
    const router = new ProviderRouter(cfg.providers);
    const stats = router.getStats();
    for (const s of stats) {
      console.log(`  ${chalk.bold(s.name)}: ${s.status}`);
    }
    return;
  }

  console.log(chalk.yellow('Unknown subcommand:'), sub);
  console.log(chalk.dim('  mycode config list     show config'));
  console.log(chalk.dim('  mycode config test     test providers'));
  console.log(chalk.dim('  mycode config remove <name>  remove provider'));
}
