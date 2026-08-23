export function createMockAgentSession() {
  return {
    run: async () => 'mock result',
    abort: () => {},
    getState: () => ({ running: false, iterations: 0 }),
  };
}
