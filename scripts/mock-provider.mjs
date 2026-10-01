/**
 * Minimal OpenAI-compatible chat-completions server for end-to-end smoke tests.
 *
 * Scripts a deterministic agentic sequence so the harness can be exercised
 * without a real API key:
 *   1. todo_write        — create a plan
 *   2. write_file        — write a file (triggers post-write verification)
 *   3. final answer      — stop the loop
 *
 * Usage: node scripts/mock-provider.mjs [port]
 * Then point a provider at http://127.0.0.1:<port>/v1
 */
import { createServer } from 'http';

const port = Number(process.argv[2] ?? 4141);

function sse(res, chunks) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function chunk(delta, finish = null, usage = null) {
  const c = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  if (usage) c.usage = usage;
  return c;
}

/** Fake but plausible token accounting, so usage plumbing is exercised. */
const usageFor = (body) => ({
  prompt_tokens: Math.ceil(body.length / 4),
  completion_tokens: 25,
  total_tokens: Math.ceil(body.length / 4) + 25,
});

const server = createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404).end('{}');
    return;
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const wantsTools = body.includes('"tools"');
    // Stateless scripting: decide the next step from the conversation so the
    // mock behaves the same on every run (and can be reused across tests).
    const hasTodoResult = body.includes('call_todo_1');
    const hasWriteResult = body.includes('call_write_1');
    // Sub-agent scripting. The child is a separate conversation: identify it by
    // the *absence* of the parent's task text, since both sessions mention
    // "sub-agent" in their tool definitions.
    const PARENT_TASK = 'investigate the auth flow';
    const isChild = !body.includes(PARENT_TASK);

    if (!wantsTools) {
      // A plain completion (used by the compaction summariser).
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({ content: '## Objective\nSmoke-test the harness.\n\n## Important Details\nNone.\n' }),
        chunk({}, 'stop', usageFor(body)),
      ]);
      return;
    }

    if (isChild) {
      // The child does one read then reports back.
      if (body.includes('child_read_done')) {
        sse(res, [
          chunk({ role: 'assistant', content: '' }),
          chunk({ content: 'Report: the auth flow lives in src/auth.ts:42.' }),
          chunk({}, 'stop', usageFor(body)),
        ]);
        return;
      }
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'child_read_done',
              type: 'function',
              function: { name: 'read_file', arguments: JSON.stringify({ path: 'hello.txt' }) },
            },
          ],
        }),
        chunk({}, 'tool_calls', usageFor(body)),
      ]);
      return;
    }

    if (!hasTodoResult) {
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_todo_1',
              type: 'function',
              function: {
                name: 'todo_write',
                arguments: JSON.stringify({
                  todos: [
                    { content: 'Write hello.txt', status: 'in_progress', priority: 'high' },
                    { content: 'Verify the file', status: 'pending' },
                  ],
                }),
              },
            },
          ],
        }),
        chunk({}, 'tool_calls', usageFor(body)),
      ]);
      return;
    }

    if (!hasWriteResult) {
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_write_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'hello.txt', content: 'hello from mock\n' }),
              },
            },
          ],
        }),
        chunk({}, 'tool_calls', usageFor(body)),
      ]);
      return;
    }

    // Delegate once, then finish.
    if (!body.includes('call_delegate_1')) {
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_delegate_1',
              type: 'function',
              function: {
                name: 'delegate',
                arguments: JSON.stringify({ kind: 'explore', task: 'find where the auth flow lives' }),
              },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ]);
      return;
    }

    // Final answer, streamed as text.
    sse(res, [
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: 'Wrote hello.txt and verified the plan.' }),
      chunk({}, 'stop', usageFor(body)),
    ]);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`mock provider listening on http://127.0.0.1:${port}/v1`);
});
