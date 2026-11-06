import { createSignal } from 'solid-js';
import { render, useKeyboard } from '@opentui/solid';
import { activeTheme } from './theme.js';
import { StatusLine, type TuiStatusState } from './components/StatusLine.js';
import { Transcript, type TranscriptMessage } from './components/Transcript.js';
import { Composer, type SlashMenuItem } from './components/Composer.js';

export interface TuiAppOptions {
  version: string;
  model: string;
  cwd: string;
  commands: SlashMenuItem[];
  initialStatus: TuiStatusState;
  onSubmit: (text: string) => void;
}

export function AppShell(props: TuiAppOptions) {
  const t = activeTheme;
  const [messages, setMessages] = createSignal<TranscriptMessage[]>([
    { id: 'm0', role: 'system', text: `MyCode ${props.version} · ${props.model} · ${props.cwd}` },
  ]);
  const [status, setStatus] = createSignal<TuiStatusState>(props.initialStatus);

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') props.onSubmit('/exit');
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingRight={2}>
        <text fg={t.brand}>◆ MyCode {props.version}</text>
        <text fg={t.textDim}> {props.model}</text>
      </box>
      <box flexGrow={1}>
        <Transcript messages={messages()} />
      </box>
      <Composer
        commands={props.commands}
        onSubmit={(text) => {
          setMessages((m) => [...m, { id: `u${m.length}`, role: 'user', text }]);
          props.onSubmit(text);
        }}
        onExit={() => props.onSubmit('/exit')}
      />
      <StatusLine state={status()} />
    </box>
  );
}

export function pushAssistantText(
  _setMessages: (fn: (m: TranscriptMessage[]) => TranscriptMessage[]) => void,
  _text: string,
): void {
  // Wired to session onText/onToolCall in Phase 4 integration.
}

if (import.meta.main) {
  render(() => (
    <AppShell
      version="dev"
      model="default"
      cwd={process.cwd()}
      commands={[{ name: 'exit', description: 'Exit the session' }]}
      initialStatus={{ model: 'default', usedTokens: 0, contextWindow: 128000 }}
      onSubmit={(text) => {
        if (text === '/exit') process.exit(0);
      }}
    />
  ));
}

