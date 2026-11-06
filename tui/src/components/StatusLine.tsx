import { activeTheme } from '../theme.js';
import { fmtTokens, fmtDuration, contextTone, truncate } from '../format.js';

export interface TuiStatusState {
  model?: string;
  provider?: string;
  usedTokens?: number;
  contextWindow?: number;
  elapsedMs?: number;
  toolCalls?: number;
  filesTouched?: number;
  queued?: number;
  stashed?: number;
  failover?: string | null;
  costUsd?: number;
  /** Safety-relevant bypass badge — always rendered first, never truncated away. */
  bypass?: string | null;
}

export interface StatusSegment {
  text: string;
  fg: string;
}

/** Pure segment builder (unit-testable without a renderer). */
export function buildStatusSegments(s: TuiStatusState, width: number): StatusSegment[] {
  const t = activeTheme;
  const segs: StatusSegment[] = [];
  if (s.bypass) segs.push({ text: `⚡ ${s.bypass}`, fg: t.error });
  if (s.model) {
    const label = s.provider && s.provider !== s.model ? `${s.provider}/${s.model}` : s.model;
    segs.push({ text: `⚕ ${truncate(label, 34)}`, fg: t.provider });
  }
  if (s.usedTokens !== undefined && s.contextWindow) {
    const pct =
      s.contextWindow > 0 ? Math.min(100, Math.round((s.usedTokens / s.contextWindow) * 100)) : 0;
    const tone = contextTone(pct);
    const fg =
      tone === 'success'
        ? t.success
        : tone === 'warning'
          ? t.warning
          : tone === 'orange'
            ? '#fb923c'
            : t.error;
    const barW = 10;
    const filled = Math.round((pct / 100) * barW);
    segs.push({
      text: `${fmtTokens(s.usedTokens)}/${fmtTokens(s.contextWindow)} ${'█'.repeat(filled)}${'░'.repeat(barW - filled)} ${pct}%`,
      fg,
    });
  }
  if (s.elapsedMs !== undefined) segs.push({ text: fmtDuration(s.elapsedMs), fg: t.textDim });
  if (s.queued) segs.push({ text: `${s.queued} queued`, fg: t.warning });
  if (s.stashed) segs.push({ text: `${s.stashed} stashed`, fg: t.warning });
  if (typeof s.costUsd === 'number') segs.push({ text: `$${s.costUsd.toFixed(2)}`, fg: t.textDim });
  const plain = ' ' + segs.map((g) => g.text).join(' │ ');
  if (plain.length > width - 1) {
    const keep = s.bypass ? 4 : 3;
    return segs.slice(0, keep);
  }
  return segs;
}

/** Plain-text form for snapshots and narrow-terminal assertions. */
export function buildStatusText(s: TuiStatusState, width: number): string {
  return ' ' + buildStatusSegments(s, width).map((g) => g.text).join(' │ ');
}

export function StatusLine(props: { state: TuiStatusState }) {
  const t = activeTheme;
  const segs = buildStatusSegments(props.state, 240);
  return (
    <box height={1} flexDirection="row">
      <text fg={t.textDim}> </text>
      {segs.flatMap((g, i) => {
        const nodes = [
          <text fg={g.fg}>
            {g.text}
          </text>,
        ];
        if (i < segs.length - 1) {
          nodes.unshift(
            <text fg={t.textDim}>
              {' │ '}
            </text>,
          );
        }
        return nodes;
      })}
    </box>
  );
}
