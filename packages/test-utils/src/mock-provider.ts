export function createMockProvider(name = 'mock', model = 'mock-model') {
  return {
    name,
    model,
    chat: async () => ({ content: 'mock response', tool_calls: [] }),
    stream: async function* () {},
  };
}
