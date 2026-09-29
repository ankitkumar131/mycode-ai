import { CliAgentProvider } from './cli-agent-provider.js';

describe('CliAgentProvider', () => {
  it('runs an external agent command, streams output, and returns normalized text', async () => {
    const chunks: string[] = [];
    const provider = new CliAgentProvider({
      name: 'munder-test',
      apiProvider: 'cli',
      model: 'test-model',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("external response")'],
    });

    const result = await provider.chat(
      [{ role: 'user', content: 'hello' }],
      undefined,
      { cwd: process.cwd(), onStream: (chunk: string) => chunks.push(chunk) },
    );

    expect(result.content).toBe('external response');
    expect(chunks.join('')).toBe('external response');
    expect(provider.getHealth().successCount).toBe(1);
  });

  it('fails clearly when no external command is configured', async () => {
    const provider = new CliAgentProvider({ name: 'missing', apiProvider: 'cli', model: 'x' });
    await expect(provider.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('no command configured');
  });
});
