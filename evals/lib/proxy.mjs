/**
 * Recording LLM proxy.
 *
 * Sits between the agent under test and the real provider, and records what
 * actually crossed the wire. This is what makes a head-to-head comparison
 * honest: both agents are pointed at the same base URL with the same key, so
 * request counts, prompt tokens, completion tokens and latency are measured
 * identically rather than read out of each agent's own accounting (which
 * differs in what it counts and when it resets).
 *
 * Also useful on its own: it gives an exact, per-request view of how much
 * context an agent ships, which is the number that decides cost.
 *
 *   node evals/lib/proxy.mjs --port 4300 --upstream https://api.openai.com/v1 \
 *     --record evals/runs/mycode/task-name/run-1/requests.jsonl
 */
import { createServer } from 'http';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4300);
const upstream = (args.upstream ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const recordPath = args.record ?? null;
const maxRequests = args['max-requests'] ? Number(args['max-requests']) : 0;

if (recordPath) mkdirSync(dirname(recordPath), { recursive: true });

const stats = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  errors: 0,
  bytesIn: 0,
  bytesOut: 0,
  latencyMs: 0,
  firstByteMs: 0,
  byModel: {},
  toolsAdvertised: 0,
  start: Date.now(),
};

function record(entry) {
  if (!recordPath) return;
  try {
    appendFileSync(recordPath, JSON.stringify(entry) + '\n');
  } catch {
    /* recording must never break the agent under test */
  }
}

/** Pull usage out of either a JSON body or the tail of an SSE stream. */
function extractUsage(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    let usage = null;
    let completionChars = 0;
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.usage) usage = ev.usage;
        const delta = ev.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') completionChars += delta.length;
        // Anthropic-style streams carry usage on message_start/message_delta.
        if (ev.message?.usage) usage = { ...ev.message.usage, ...usage };
      } catch {
        /* partial frame */
      }
    }
    return { usage, completionChars };
  }
  try {
    const data = JSON.parse(text);
    return { usage: data.usage ?? null, completionChars: data.choices?.[0]?.message?.content?.length ?? 0 };
  } catch {
    return { usage: null, completionChars: 0 };
  }
}

const server = createServer((req, res) => {
  if (req.url === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...stats, wallMs: Date.now() - stats.start }));
    return;
  }

  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    const started = Date.now();
    stats.requests++;
    stats.bytesIn += Buffer.byteLength(body);

    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* not JSON; forward as-is */
    }

    // Wrap the response so we can tee it for accounting without buffering the
    // whole stream (a streaming reply must stay streaming for the agent).
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstream + req.url, {
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'] ?? 'application/json',
          authorization: req.headers.authorization ?? '',
          'x-api-key': req.headers['x-api-key'] ?? '',
          'anthropic-version': req.headers['anthropic-version'] ?? '',
          accept: req.headers.accept ?? 'application/json',
        },
        body: req.method === 'GET' ? undefined : body,
      });
    } catch (err) {
      stats.errors++;
      record({ at: Date.now(), error: String(err?.message ?? err) });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `proxy: upstream unreachable: ${err?.message}` } }));
      return;
    }

    const contentType = upstreamRes.headers.get('content-type') ?? '';
    const chunks = [];
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();

    // Relay headers, dropping hop-by-hop ones.
    const headers = {};
    upstreamRes.headers.forEach((v, k) => {
      if (['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) return;
      headers[k] = v;
    });
    res.writeHead(upstreamRes.status, headers);

    let firstByte = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByte) firstByte = Date.now() - started;
      const text = decoder.decode(value, { stream: true });
      chunks.push(text);
      stats.bytesOut += Buffer.byteLength(text);
      res.write(value);
    }
    res.end();

    const latencyMs = Date.now() - started;
    const text = chunks.join('');
    const { usage } = extractUsage(text, contentType);

    // Normalise across providers: OpenAI uses prompt/completion, Anthropic uses
    // input/output plus cache fields.
    const promptTokens =
      usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const completionTokens =
      usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    const cachedTokens =
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens ??
      0;

    stats.promptTokens += promptTokens + cachedTokens;
    stats.completionTokens += completionTokens;
    stats.cachedTokens += cachedTokens;
    stats.latencyMs += latencyMs;
    stats.firstByteMs += firstByte;
    if (upstreamRes.status >= 400) stats.errors++;

    const model = parsed.model ?? 'unknown';
    stats.byModel[model] ??= { requests: 0, promptTokens: 0, completionTokens: 0 };
    stats.byModel[model].requests++;
    stats.byModel[model].promptTokens += promptTokens + cachedTokens;
    stats.byModel[model].completionTokens += completionTokens;

    if (Array.isArray(parsed.tools)) stats.toolsAdvertised = Math.max(stats.toolsAdvertised, parsed.tools.length);

    record({
      at: Date.now(),
      model,
      status: upstreamRes.status,
      latencyMs,
      firstByteMs: firstByte,
      promptTokens: promptTokens + cachedTokens,
      completionTokens,
      cachedTokens,
      // The number that decides cost and behaviour: how much context the agent
      // chose to send this turn.
      messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      streamed: !!parsed.stream,
      systemChars: typeof parsed.system === 'string' ? parsed.system.length : 0,
    });

    if (maxRequests && stats.requests >= maxRequests) {
      // Leave the process alive so the caller can read /__stats.
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`recording proxy on http://127.0.0.1:${port} -> ${upstream}`);
  if (recordPath) console.log(`recording to ${recordPath}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  });
}
