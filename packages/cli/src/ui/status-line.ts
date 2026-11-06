/**
 * Persistent status line.
 *
 * MyCode computed everything needed for this (`/usage`, `/status`, `/context`)
 * but only on demand, so the user had no ambient sense of how much context was
 * left or how much the session had cost. On long tasks that is the difference
 * between compacting deliberately and hitting a hard ceiling by surprise.
 */

import chalk from 'chalk';
import { theme } from './themes/theme.js';
import type { SessionUsage } from '@mycode/core';

export interface StatusLineState {
  model?: string;
  provider?: string;
  /** Estimated tokens currently in context. */
  usedTokens?: number;
  /** Effective context window for the active provider. */
  contextWindow?: number;
  usage?: SessionUsage;
  /** Session elapsed time in ms. */
  elapsedMs?: number;
  /** Number of tool calls this session. */
  toolCalls?: number;
  filesTouched?: number;
  queued?: number;
  /** Non-null when the session has failed over at least once. */
  failover?: string | null;
  /** Estimated spend, when the provider is one we can price. */
  costUsd?: number;
  /**
   * Active approval bypass ('ALLOW-ALL', 'ALLOW-ALL:writes', 'YOLO').
   * Rendered first: it is safety-relevant state, so it must survive truncation.
   */
  bypass?: string | null;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
}

export function fmtCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Colour for the context gauge: green → amber → orange → red as it fills. */
function contextColour(pct: number): string {
  if (pct < 50) return theme.success;
  if (pct < 80) return theme.warning;
  if (pct < 95) return '#fb923c';
  return theme.error;
}

export function renderStatusLine(s: StatusLineState): string {
  const parts: string[] = [];

  if (s.model) {
    const label = s.provider && s.provider !== s.model ? `${s.provider}/${s.model}` : s.model;
    parts.push(chalk.hex(theme.provider)(truncate(label, 34)));
  }

  if (s.usedTokens !== undefined && s.contextWindow) {
    const pct = s.contextWindow > 0 ? Math.min(100, Math.round((s.usedTokens / s.contextWindow) * 100)) : 0;
    const col = contextColour(pct);
    parts.push(
      chalk.hex(col)(`${fmtTokens(s.usedTokens)}/${fmtTokens(s.contextWindow)}`) +
        ' ' +
        chalk.hex(col)(`${pct}%`)
    );
  }

  if (s.costUsd !== undefined && s.costUsd > 0) parts.push(chalk.hex(theme.success)(fmtCost(s.costUsd)));

  if (s.elapsedMs !== undefined) parts.push(chalk.hex(theme.textMuted)(fmtDuration(s.elapsedMs)));

  const bypass = s.bypass
    ? chalk.hex(theme.error).bold(`⚡ ${s.bypass}`)
    : null;
  if (bypass) parts.unshift(bypass);

  const stats: string[] = [];
  if (s.toolCalls) stats.push(`${s.toolCalls} tools`);
  if (s.filesTouched) stats.push(`${s.filesTouched} file${s.filesTouched === 1 ? '' : 's'}`);
  if (stats.length) parts.push(chalk.hex(theme.textDim)(stats.join(' · ')));

  if (s.queued) parts.push(chalk.hex(theme.warning)(`${s.queued} queued`));

  if (s.failover) parts.push(chalk.hex(theme.switch)(`↻ ${s.failover}`));

  return chalk.hex(theme.textDim)('  ') + parts.join(chalk.hex(theme.border)('  ·  '));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Single-line string for embedding in a prompt prefix. */
export function compactStatus(s: StatusLineState): string {
  const bits: string[] = [];
  if (s.bypass) bits.push(`⚡ ${s.bypass}`);
  if (s.model) bits.push(s.model);
  if (s.usedTokens !== undefined && s.contextWindow) {
    const pct = s.contextWindow > 0 ? Math.round((s.usedTokens / s.contextWindow) * 100) : 0;
    bits.push(`${pct}% ctx`);
  }
  if (s.toolCalls) bits.push(`${s.toolCalls} tools`);
  if (s.failover) bits.push('↻ failover');
  return bits.join(' · ');
}

/** Rough prices in USD per **million** tokens for common models. Null if unknown. */
export function estimateCost(inputTokens: number, outputTokens: number, model: string | undefined): number | null {
  if (!model) return null;
  const m = model.toLowerCase();
  let inPrice = 0;
  let outPrice = 0;

  if (/opus/.test(m)) { inPrice = 15; outPrice = 75; }
  else if (/sonnet/.test(m)) { inPrice = 3; outPrice = 15; }
  else if (/haiku/.test(m)) { inPrice = 0.25; outPrice = 1.25; }
  else if (/gpt-5|gpt-4\.1|o3|o4/.test(m)) { inPrice = 2.5; outPrice = 10; }
  else if (/gpt-4o-mini/.test(m)) { inPrice = 0.15; outPrice = 0.6; }
  else if (/gpt-4o/.test(m)) { inPrice = 2.5; outPrice = 10; }
  else if (/gemini.*flash/.test(m)) { inPrice = 0.075; outPrice = 0.3; }
  else if (/gemini/.test(m)) { inPrice = 1.25; outPrice = 5; }
  else if (/deepseek/.test(m)) { inPrice = 0.14; outPrice = 0.28; }
  else return null; // free / local / unknown — do not invent a number

  return (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice;
}
