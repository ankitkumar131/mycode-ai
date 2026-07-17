import ora, { Ora } from 'ora';
import chalk from 'chalk';

const BRAND = {
  sparkle: '#60A5FA',
  accent: '#A78BFA',
  tool: '#38BDF8',
  dim: '#6B7280',
  warning: '#FBBF24',
};

export function createSpinner(providerLabel = ''): Ora {
  const label = providerLabel
    ? `${chalk.hex(BRAND.sparkle)('\u2726')} ${chalk.hex(BRAND.sparkle).bold(providerLabel)}`
    : `${chalk.hex(BRAND.sparkle)('\u2726')} ${chalk.hex(BRAND.sparkle)('Thinking...')}`;

  return ora({
    text: label,
    spinner: {
      interval: 120,
      frames: ['  \u2726', '  \u2727', '  \u2726', '  \u2727', '  \u25C6', '  \u2726'],
    },
    color: 'blue',
  });
}

export function createToolSpinner(toolName: string): Ora {
  return ora({
    text: `${chalk.hex(BRAND.accent)('\u2B21')} ${chalk.hex(BRAND.accent)(toolName)}`,
    spinner: {
      interval: 100,
      frames: ['  \u2B21', '  \u2B22', '  \u2B21', '  \u2B22'],
    },
    color: 'magenta',
  });
}

export function createSetupSpinner(message: string): Ora {
  return ora({
    text: chalk.hex(BRAND.dim)(message),
    spinner: 'dots',
    color: 'white',
    prefixText: '  ',
  });
}

export function showProviderSwitch(spinner: Ora, newProvider: string): void {
  spinner.text = `${chalk.hex(BRAND.warning)('\u21BB')} ${chalk.hex(BRAND.warning)(`Switching to ${chalk.bold(newProvider)}...`)}`;
  spinner.color = 'yellow';
}
