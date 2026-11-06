/** Formatting helpers mirrored from `packages/cli/src/ui/status-line.ts` (no chalk). */

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
  return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, '0')}m`;
}

export function fmtCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Gauge colour name resolved against the TUI theme (mirrors legacy thresholds). */
export function contextTone(pct: number): 'success' | 'warning' | 'orange' | 'error' {
  if (pct < 50) return 'success';
  if (pct < 80) return 'warning';
  if (pct < 95) return 'orange';
  return 'error';
}
