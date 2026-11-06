/**
 * Two-port mock for failover smoke tests.
 *
 *   PORT_BROKEN  — always answers 429 (simulates a rate-limited provider)
 *   PORT_HEALTHY — answers normally
 *
 * Each response also echoes the provider that served it, so the test can prove
 * the healthy provider actually took over.
 */
import { createServer } from 'http';

const brokenPort = Number(process.argv[2] ?? 4242);
const healthyPort = Number(process.argv[3] ?? 4243);

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

const chunk = (delta, finish = null) => ({
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: 'mock',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function handle(healthy) {
  return (req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (!healthy) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded, slow down', type: 'rate_limit_error' } }));
        return;
      }
      const finalText = body.includes('tool_calls') || body.includes('"tools"')
        ? 'Continuing the task on the backup provider.'
        : 'Summary of prior work.';
      sse(res, [
        chunk({ role: 'assistant', content: '' }),
        chunk({ content: finalText }),
        chunk({}, 'stop'),
      ]);
    });
  };
}

createServer(handle(false)).listen(brokenPort, '0.0.0.0', () =>
  console.log(`broken provider on http://127.0.0.1:${brokenPort}/v1 (always 429)`)
);
createServer(handle(true)).listen(healthyPort, '0.0.0.0', () =>
  console.log(`healthy provider on http://127.0.0.1:${healthyPort}/v1`)
);
