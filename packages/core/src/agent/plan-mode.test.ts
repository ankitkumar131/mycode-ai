/**
 * Plan mode is enforced at the tool layer, not asked for in the prompt.
 *
 * `/plan` was a sentence the model could ignore — and with a session approval
 * bypass armed, a "planning" turn could rewrite the repository. opencode's plan
 * agent denies edit tools outright; these tests pin the same guarantee here:
 * the mutating tools are absent from the request and refused if called anyway,
 * while read tools and `terminal` survive because inspection is the job.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.fn();
const mockExecuteTool = vi.fn();
const mockGetDefinitions = vi.fn();

vi.mock('../routing/provider-router.js', () => ({
  ProviderRouter: vi.fn(() => ({ chat: mockChat, stream: vi.fn() })),
}));

vi.mock('../tools/tool-registry.js', () => ({
  ToolRegistry: vi.fn(() => ({
    getDefinitions: mockGetDefinitions,
    executeTool: mockExecuteTool,
    canonical: (n: string) => n,
    isWriteTool: (n: string) => n === 'write_file' || n === 'terminal',
    getToolNames: () => ['read_file', 'write_file'],
  })),
}));

vi.mock('../prompts/system-prompt.js', () => ({
  SystemPromptBuilder: { buildSystemPrompt: vi.fn(async () => 'system'), default: vi.fn() },
  findContextFiles: vi.fn(() => []),
  readMemory: vi.fn(() => ''),
}));

vi.mock('./context.js', () => ({
  ConversationContext: vi.fn(() => {
    const messages: any[] = [];
    return {
      addSystem: vi.fn(),
      addUser: vi.fn(),
      addAssistant: vi.fn(),
      addAssistantWithTools: vi.fn(),
      addToolResult: vi.fn((id: string, result: string, name?: string) =>
        messages.push({ id, result, name }),
      ),
      getHistory: vi.fn(() => messages),
      getMessages: vi.fn(() => messages),
      trimToLimit: vi.fn(),
      estimateTokens: vi.fn(() => 100),
      setSystem: vi.fn(),
      addMessage: vi.fn(),
      replaceMessages: vi.fn(),
      breakdown: vi.fn(() => ({ system: 0, user: 0, assistant: 0, tool: 0, total: 0 })),
      maxTokens: 128000,
      length: 0,
    };
  }),
}));

const { AgentSession } = await import('./agent-session.js');

const TOOLS = [
  { function: { name: 'read_file' } },
  { function: { name: 'write_file' } },
  { function: { name: 'patch' } },
  { function: { name: 'execute_code' } },
  { function: { name: 'skill_manage' } },
  { function: { name: 'terminal' } },
];

function makeSession() {
  const router = {
    chat: mockChat,
    stream: vi.fn(),
    getCurrentProvider: () => ({ name: 'test', model: 'gpt-4o' }),
  };
  return new AgentSession({
    providerRouter: router as any,
    maxIterations: 1,
    onText: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onError: vi.fn(),
    onFinish: vi.fn(),
  });
}

/** The tool names the session actually offered the provider on its last call. */
function advertisedTools(): string[] {
  const calls = mockChat.mock.calls;
  const tools = calls[calls.length - 1]?.[1] ?? [];
  return tools.map((t: any) => t.function.name);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDefinitions.mockReturnValue(TOOLS);
  mockExecuteTool.mockResolvedValue('ok');
});

describe('plan mode', () => {
  it('is off by default, so every tool is advertised', async () => {
    mockChat.mockResolvedValueOnce({ content: 'done', toolCalls: [] });
    const session = makeSession();

    expect(session.isPlanMode()).toBe(false);
    await session.run('do it');

    expect(advertisedTools()).toEqual([
      'read_file',
      'write_file',
      'patch',
      'execute_code',
      'skill_manage',
      'terminal',
    ]);
  });

  it('removes the mutating tools from the request, keeping reads and terminal', async () => {
    mockChat.mockResolvedValueOnce({ content: 'planned', toolCalls: [] });
    const session = makeSession();
    session.setPlanMode(true);

    await session.run('plan it');

    expect(advertisedTools()).toEqual(['read_file', 'terminal']);
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it('refuses a mutating tool the model calls anyway, without executing it', async () => {
    const onToolResult = vi.fn();
    const onToolCall = vi.fn();
    mockChat
      .mockResolvedValueOnce({
        content: 'writing',
        toolCalls: [
          {
            id: 'call1',
            type: 'function',
            function: { name: 'write_file', arguments: '{"path":"hello.txt","content":"x"}' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'stopped', toolCalls: [] });

    const router = {
      chat: mockChat,
      stream: vi.fn(),
      getCurrentProvider: () => ({ name: 'test', model: 'gpt-4o' }),
    };
    const session = new AgentSession({
      providerRouter: router as any,
      maxIterations: 3,
      onToolResult: onToolResult as any,
      onText: vi.fn(),
      onToolCall: onToolCall as any,
      onError: vi.fn(),
      onFinish: vi.fn(),
    });
    session.setPlanMode(true);

    await session.run('plan it');

    expect(mockExecuteTool).not.toHaveBeenCalled();
    const [, message] = onToolResult.mock.calls[0] as [string, string];
    expect(message).toMatch(/unavailable in plan mode/i);
    expect(onToolResult.mock.calls[0][2]).toMatchObject({ error: true });
    // And the attempt is announced, so a host can show it instead of leaving
    // the user wondering why nothing happened.
    expect(onToolCall).toHaveBeenCalledWith('write_file', expect.anything());
  });

  it('restores the tools when the mode is left', async () => {
    mockChat.mockResolvedValue({ content: 'ok', toolCalls: [] });
    const session = makeSession();

    session.setPlanMode(true);
    await session.run('plan');
    expect(advertisedTools()).not.toContain('write_file');

    session.setPlanMode(false);
    await session.run('build');
    expect(advertisedTools()).toContain('write_file');
    expect(session.isPlanMode()).toBe(false);
  });

  it('never mutates the registry itself, so /tools and toolsets are untouched', async () => {
    mockChat.mockResolvedValueOnce({ content: 'planned', toolCalls: [] });
    const session = makeSession();
    const registry = session.getRegistry() as any;

    session.setPlanMode(true);
    await session.run('plan it');

    // The filter lives in the session, not in the registry: a user's own
    // disable/enable choices survive entering and leaving plan mode.
    expect(registry.disable).toBeUndefined();
    expect(mockGetDefinitions).toHaveBeenCalled();
  });
});
