import type { AgentOptions } from './types.js';

const mockChat = vi.fn();
const mockExecuteTool = vi.fn();
const mockGetDefinitions = vi.fn();
const mockBuildSystemPrompt = vi.fn();
const mockTranslate = vi.fn();

vi.mock('../routing/provider-router.js', () => ({
  ProviderRouter: vi.fn(() => ({
    chat: mockChat,
    stream: vi.fn(),
  })),
}));

vi.mock('../tools/tool-registry.js', () => ({
  ToolRegistry: vi.fn(() => ({
    getDefinitions: mockGetDefinitions,
    executeTool: mockExecuteTool,
  })),
}));

vi.mock('../prompts/system-prompt.js', () => ({
  SystemPromptBuilder: {
    buildSystemPrompt: mockBuildSystemPrompt,
    default: vi.fn(),
  },
}));

vi.mock('./event-translator.js', () => ({
  EventTranslator: vi.fn(() => ({
    translate: mockTranslate,
  })),
}));

vi.mock('./context.js', () => ({
  ConversationContext: vi.fn(() => {
    const messages: any[] = [];
    return {
      addSystem: vi.fn((c: string) => messages.push({ role: 'system', content: c })),
      addUser: vi.fn((c: string) => messages.push({ role: 'user', content: c })),
      addAssistant: vi.fn((c: string) => messages.push({ role: 'assistant', content: c })),
      addAssistantWithTools: vi.fn(),
      addToolResult: vi.fn(),
      getHistory: vi.fn(() => messages),
      trimToLimit: vi.fn(),
      length: 0,
    };
  }),
}));

const { AgentSession } = await import('./agent-session.js');

function makeSession(opts?: Partial<import('./agent-session.js').SessionConfig>) {
  const router = { chat: mockChat, stream: vi.fn() };
  return new AgentSession({
    providerRouter: router as any,
    ...opts,
    onText: opts?.onText ?? vi.fn(),
    onToolCall: opts?.onToolCall ?? vi.fn(),
    onToolResult: opts?.onToolResult ?? vi.fn(),
    onError: opts?.onError ?? vi.fn(),
    onFinish: opts?.onFinish ?? vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChat.mockReset();
  mockExecuteTool.mockReset();
  mockGetDefinitions.mockReset();
  mockBuildSystemPrompt.mockReset();
  mockTranslate.mockReset();

  mockBuildSystemPrompt.mockResolvedValue('You are MyCode, an AI coding agent.');
  mockGetDefinitions.mockReturnValue([{ function: { name: 'read-file' } }]);
});

describe('AgentSession', () => {
  it('initializes with default state', () => {
    const session = makeSession();
    const state = session.getState();
    expect(state.running).toBe(false);
    expect(state.iterations).toBe(0);
    expect(state.aborted).toBe(false);
  });

  it('processes input and returns response text', async () => {
    mockChat
      .mockResolvedValueOnce({ content: 'Hello! How can I help?', toolCalls: [] });

    const session = makeSession();
    const result = await session.run('Hi');

    expect(result).toBe('Hello! How can I help?');
    expect(mockBuildSystemPrompt).toHaveBeenCalled();
    expect(mockChat).toHaveBeenCalled();
  });

  it('passes onStream to router.chat options', async () => {
    const onText = vi.fn();

    mockChat.mockImplementationOnce(async (_messages: any, _tools: any, options: any) => {
      if (options?.onStream) {
        options.onStream('Processing...');
      }
      return { content: 'Processing...', toolCalls: [] };
    });

    const session = makeSession({ onText });
    await session.run('Do something');

    expect(onText).toHaveBeenCalledWith('Processing...');
  });

  it('executes tool calls and continues the loop', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: 'Let me check that...',
        toolCalls: [
          { id: 'call1', type: 'function', function: { name: 'read-file', arguments: '{"path": "test.txt"}' } },
        ],
      })
      .mockResolvedValueOnce({ content: 'Here is the file content.', toolCalls: [] });

    mockExecuteTool.mockResolvedValueOnce('File content: hello');

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const session = makeSession({ onToolCall, onToolResult });
    const result = await session.run('Read a file');

    expect(result).toBe('Here is the file content.');
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockExecuteTool).toHaveBeenCalledWith('read-file', { path: 'test.txt' }, expect.any(String), expect.any(Object));
    expect(onToolCall).toHaveBeenCalledWith('read-file', { path: 'test.txt' });
    expect(onToolResult).toHaveBeenCalledWith('read-file', 'File content: hello');
  });

  it('handles empty tool definitions gracefully', async () => {
    mockGetDefinitions.mockReturnValue([]);
    mockChat.mockResolvedValueOnce({ content: 'No tools needed.', toolCalls: [] });

    const session = makeSession();
    const result = await session.run('Do something simple');
    expect(result).toBe('No tools needed.');
    expect(mockChat).toHaveBeenCalledWith(expect.any(Array), undefined, expect.any(Object));
  });

  it('handles tool execution errors gracefully', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: 'Running tool...',
        toolCalls: [
          { id: 'call1', type: 'function', function: { name: 'read-file', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: 'Fixed it.', toolCalls: [] });

    mockExecuteTool.mockRejectedValueOnce(new Error('Permission denied'));

    const session = makeSession();
    const result = await session.run('Do something');

    expect(result).toBe('Fixed it.');
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('Permission denied') })
    );
  });

  it('deduplicates identical tool calls', async () => {
    const args = '{"path": "file.txt"}';
    mockChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'call1', type: 'function', function: { name: 'read-file', arguments: args } },
          { id: 'call2', type: 'function', function: { name: 'read-file', arguments: args } },
        ],
      })
      .mockResolvedValueOnce({ content: 'Done.', toolCalls: [] });

    mockExecuteTool.mockResolvedValue('result');

    const session = makeSession();
    await session.run('Read file twice');

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('aborts mid-execution', async () => {
    let resolveChat: ((v: any) => void) | undefined;
    mockChat.mockImplementation(() => new Promise(resolve => { resolveChat = resolve; }));

    const session = makeSession();
    const runPromise = session.run('Long task');

    // Wait for run() to enter the while loop and await router.chat()
    await new Promise(r => setTimeout(r, 0));

    session.abort();
    resolveChat?.({ content: '', toolCalls: [] });

    const result = await runPromise;
    expect(result).toBe('Session aborted.');
  });

  it('returns correct state after execution', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Done.', toolCalls: [] });

    const session = makeSession();
    const stateBefore = session.getState();
    expect(stateBefore.running).toBe(false);

    await session.run('Test');

    const stateAfter = session.getState();
    expect(stateAfter.running).toBe(false);
    expect(stateAfter.iterations).toBeGreaterThan(0);
  });

  it('emits finish event on completion', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Done.', toolCalls: [] });

    const session = makeSession();
    await session.run('Test');

    expect(mockTranslate).toHaveBeenCalledWith(expect.objectContaining({ type: 'finish' }));
  });

  it('emits error event when provider throws', async () => {
    mockChat.mockRejectedValueOnce(new Error('API unavailable'));

    const session = makeSession();
    const result = await session.run('Test');

    expect(result).toContain('API unavailable');
    expect(mockTranslate).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns context from getContext', () => {
    const session = makeSession();
    const ctx = session.getContext();
    expect(ctx).toBeDefined();
  });

  it('returns registry from getRegistry', () => {
    const session = makeSession();
    const reg = session.getRegistry();
    expect(reg).toBeDefined();
  });

  it('blocks tool after maximum retries on failure', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: 'Call failing tool',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read-file', arguments: '{"f": 1}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call failing tool again',
        toolCalls: [{ id: 'c2', type: 'function', function: { name: 'read-file', arguments: '{"f": 2}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call failing tool third time',
        toolCalls: [{ id: 'c3', type: 'function', function: { name: 'read-file', arguments: '{"f": 3}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call failing tool fourth time',
        toolCalls: [{ id: 'c4', type: 'function', function: { name: 'read-file', arguments: '{"f": 4}' } }],
      })
      .mockResolvedValueOnce({ content: 'Done.', toolCalls: [] });

    mockExecuteTool.mockRejectedValue(new Error('failing'));

    const session = makeSession();
    await session.run('Test failure');

    // The tool should only be executed 3 times, because on the 4th time it should be blocked by retry limit!
    expect(mockExecuteTool).toHaveBeenCalledTimes(3);
  });

  it('does not block tool on success even after multiple calls', async () => {
    mockChat
      .mockResolvedValueOnce({
        content: 'Call tool',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read-file', arguments: '{"s": 1}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call tool again',
        toolCalls: [{ id: 'c2', type: 'function', function: { name: 'read-file', arguments: '{"s": 2}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call tool third time',
        toolCalls: [{ id: 'c3', type: 'function', function: { name: 'read-file', arguments: '{"s": 3}' } }],
      })
      .mockResolvedValueOnce({
        content: 'Call tool fourth time',
        toolCalls: [{ id: 'c4', type: 'function', function: { name: 'read-file', arguments: '{"s": 4}' } }],
      })
      .mockResolvedValueOnce({ content: 'Finished successfully.', toolCalls: [] });

    mockExecuteTool.mockResolvedValue('success result');

    const session = makeSession();
    const result = await session.run('Test multi success');

    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
    expect(result).toBe('Finished successfully.');
  });
});
