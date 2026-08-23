export interface TerminalMessage {
  id: string;
  sender: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
}

export interface TerminalWebClientOptions {
  messages: TerminalMessage[];
  activeModel?: string;
  status?: string;
}

export function renderWebClientHTML(opts: TerminalWebClientOptions): string {
  const model = opts.activeModel || 'gpt-4o';
  const status = opts.status || 'ready';

  const rows = opts.messages.map((m) => {
    const isUser = m.sender === 'user';
    const borderColor = isUser ? '#ffb84d' : '#00ff88';
    const bg = isUser ? '#0a2a1c' : '#05150e';

    return `
      <div style="padding: 8px 12px; background: ${bg}; border-left: 3px solid ${borderColor}; border-radius: 4px; margin-bottom: 8px;">
        <div style="font-size: 0.75rem; color: #7a8a82; margin-bottom: 4px;">
          [${m.timestamp}] ${m.sender.toUpperCase()} ${m.toolName ? `(${m.toolName})` : ''}
        </div>
        <div style="white-space: pre-wrap; line-height: 1.4; color: #e6edf3;">
          ${m.content}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="font-family: monospace; background-color: #000000; color: #00ff88; padding: 16px; border-radius: 8px; border: 1px solid #1a4a36; max-width: 900px; margin: 0 auto; box-shadow: 0 0 20px rgba(0, 255, 136, 0.15);">
      <div style="border-bottom: 1px solid #1a4a36; padding-bottom: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: bold; font-size: 1.1rem;">◆ MYCODE TERMINAL WEB CLIENT</div>
        <div style="font-size: 0.85rem; color: #7fffb4;">Model: ${model} | Status: ${status}</div>
      </div>
      <div style="height: 450px; overflow-y: auto; display: flex; flex-direction: column;">
        ${rows}
      </div>
    </div>
  `;
}
