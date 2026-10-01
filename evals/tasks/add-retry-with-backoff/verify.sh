#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/net.js').then(async m => {
  let calls = 0;
  const ok = await m.request(async () => { calls++; if (calls < 3) throw new Error('boom'); return 'done'; });
  if (ok !== 'done' || calls !== 3) { console.error('retry failed', ok, calls); process.exit(1); }
  let n = 0;
  let threw = false;
  try { await m.request(async () => { n++; const e = new Error('bad request'); e.status = 400; throw e; }); } catch { threw = true; }
  if (!threw || n !== 1) { console.error('should not retry 4xx, calls=' + n); process.exit(1); }
})" || exit 1
exit 0
