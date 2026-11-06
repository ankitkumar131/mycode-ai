import { For } from 'solid-js';
import { activeTheme } from '../theme.js';

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system';

export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  /** Main body (markdown-ish plain text for now; shiki/marked in Phase 2b). */
  text: string;
  /** One-line detail, e.g. tool path/command summary. */
  detail?: string;
  error?: boolean;
  durationMs?: number;
}

function roleColor(role: TranscriptRole, error: boolean, theme = activeTheme): string {
  if (error) return theme.error;
  switch (role) {
    case 'user':
      return theme.brandLight;
    case 'assistant':
      return theme.text;
    case 'tool':
      return theme.tool;
    case 'system':
      return theme.textDim;
  }
}

export function Transcript(props: { messages: TranscriptMessage[] }) {
  const t = activeTheme;
  return (
    <scrollbox stickyScroll stickyStart="bottom">
      <For each={props.messages}>
        {(m) => (
          <box flexDirection="column" paddingLeft={2} paddingRight={2}>
            <text fg={roleColor(m.role, !!m.error)}>
              {m.role === 'user' ? '❯ ' : m.role === 'tool' ? '◆ ' : ''}
              {m.detail ?? m.text.split('\n')[0]?.slice(0, 100) ?? ''}
            </text>
            {m.role !== 'tool' ? <text fg={t.text}>{m.text}</text> : null}
            {m.role === 'tool' && m.error ? <text fg={t.error}>{m.text}</text> : null}
          </box>
        )}
      </For>
    </scrollbox>
  );
}
