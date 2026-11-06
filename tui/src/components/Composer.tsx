import { createSignal, createMemo, For, Show } from 'solid-js';
import type { TextareaRenderable } from '@opentui/core';
import fuzzysort from 'fuzzysort';
import { activeTheme } from '../theme.js';

export interface SlashMenuItem {
  name: string;
  description: string;
  argumentHint?: string;
  kind?: 'command' | 'skill' | 'quick';
}

/**
 * Fuzzy-filter `/` menu items. Pure — unit-tested without a renderer.
 * Mirrors legacy `TextArea` live-filtering (commands + skills + quick).
 */
export function filterSlashMenu(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const q = query.replace(/^\//, '').trim();
  if (!q) return items;
  try {
    const results = fuzzysort.go(q, items, { keys: ['name', 'description'] });
    if (results.length > 0) return results.map((r) => r.obj);
  } catch {
    /* fall through to substring */
  }
  const lower = q.toLowerCase();
  return items.filter(
    (i) => i.name.toLowerCase().includes(lower) || i.description.toLowerCase().includes(lower),
  );
}

/** True when the current input should show the slash menu. */
export function isSlashInput(text: string): boolean {
  return text.startsWith('/');
}

export function Composer(props: {
  commands: SlashMenuItem[];
  onSubmit: (text: string) => void;
  onExit: () => void;
}) {
  const t = activeTheme;
  let area!: TextareaRenderable;
  const [value, setValue] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  const menu = createMemo(() =>
    isSlashInput(value()) ? filterSlashMenu(props.commands, value()) : [],
  );

  const submitCurrent = () => {
    const raw = area?.plainText ?? value();
    const v = raw.trim();
    if (!v) return;
    setValue('');
    setSelected(0);
    try {
      area?.editBuffer.setText('');
    } catch {
      /* non-fatal: buffer already tracks onContentChange */
    }
    props.onSubmit(v);
  };

  return (
    <box flexDirection="column" border>
      <Show when={menu().length > 0}>
        <box flexDirection="column">
          <For each={menu().slice(0, 8)}>
            {(item, i) => (
              <text fg={i() === selected() ? t.brand : t.textDim}>
                {i() === selected() ? '▸ ' : '  '}/{item.name} {item.description}
              </text>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row">
        <text fg={t.brand}>❯ </text>
        <textarea
          ref={area}
          focused
          initialValue=""
          placeholder="Ask anything — / commands · ! shell · @file"
          onContentChange={(v) => {
            // Solid passes the buffer text; core may pass a change event instead.
            setValue(typeof v === 'string' ? v : (area?.plainText ?? ''));
            setSelected(0);
          }}
          onSubmit={submitCurrent}
        />
      </box>
      <text fg={t.textDim}>Enter send · Ctrl+Enter newline · Tab complete · Esc close menu</text>
    </box>
  );
}
