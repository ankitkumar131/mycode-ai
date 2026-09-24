import { ConfigManager, ProviderRouter, classifyError } from '@mycode/core';
import chalk from 'chalk';

/** Human label for the failure class, so the output names the cause not the code. */
function describeFailure(err: unknown): { label: string; hint: string } {
  const e = err as any;
  const status = e?.statusCode ?? e?.status;
  const name = e?.name ?? '';
  const msg: string = e?.message ?? String(err);

  if (name === 'AuthError' || status === 401 || status === 403) {
    return { label: 'auth error', hint: 'API key rejected — update it with `mycode config add`' };
  }
  if (name === 'ProviderGoneError' || status === 410 || status === 404) {
    return { label: 'endpoint gone (HTTP ' + (status ?? 410) + ')', hint: 'model removed upstream — update the model name or drop this provider' };
  }
  if (name === 'RateLimitError' || status === 429) {
    return { label: 'rate limited', hint: 'quota exhausted — wait for the reset or use a paid key' };
  }
  if (name === 'ContextLengthError') {
    return { label: 'context too long', hint: 'shorten the request' };
  }
  if (name === 'ProviderServerError' || (status >= 500 && status < 600)) {
    return { label: 'server error (HTTP ' + status + ')', hint: 'upstream outage — usually transient' };
  }
  return { label: msg || 'unknown error', hint: '' };
}

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
        // Status is not knowable without a round trip, so do not invent one.
        console.log(`  ${chalk.bold(p.name)} (${p.apiProvider})`);
        console.log(`    Model: ${p.model}`);
        console.log('');
      }
    }
    console.log(chalk.dim('  Run `mycode config test` to check which providers actually respond.'));
    console.log('');
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
    // This used to print `router.getStats()` status, which is derived from
    // `isAvailable` — a field that is only ever written as `true`. Every
    // provider therefore reported "active", including ones returning HTTP 410.
    // A diagnostic that cannot fail is worse than no diagnostic, so this now
    // makes one real minimal request per provider and classifies the result.
    console.log(chalk.cyan('Testing providers (one minimal request each)...\n'));

    let working = 0;
    for (const p of cfg.providers) {
      try {
        const router = new ProviderRouter([p]);
        const provider = router.getCurrentProvider()!;
        await provider.chat([{ role: 'user', content: 'ping' }], [], { maxTokens: 1 });
        console.log(`  ${chalk.green('✓')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.model})`)} ${chalk.green('reachable')}`);
        working++;
      } catch (err: any) {
        const { label, hint } = describeFailure(classifyError(err, p.name));
        console.log(`  ${chalk.red('✗')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.model})`)} ${chalk.red(label)}`);
        if (hint) console.log(`      ${chalk.dim(hint)}`);
      }
    }

    console.log('');
    if (working === 0) {
      console.log(chalk.yellow('  No provider responded. Fix at least one before chatting.'));
      console.log(chalk.dim('  Add or replace one with: mycode config add'));
    } else {
      console.log(chalk.dim(`  ${working} of ${cfg.providers.length} provider(s) reachable.`));
    }
    return;
  }

  console.log(chalk.yellow('Unknown subcommand:'), sub);
  console.log(chalk.dim('  mycode config list                 show config'));
  console.log(chalk.dim('  mycode config test                 check which providers respond'));
  console.log(chalk.dim('  mycode config remove <name>        remove provider'));
}
