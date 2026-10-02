const store = new Map();
const inflight = new Map();
let fetchCount = 0;

export async function fetchValue(key) {
  fetchCount++;
  await new Promise(r => setTimeout(r, 20));
  return 'v:' + key;
}

export async function get(key) {
  if (store.has(key)) return store.get(key);
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchValue(key).then((value) => {
      store.set(key, value);
      inflight.delete(key);
      return value;
    });
    inflight.set(key, pending);
  }
  return pending;
}

export function stats() {
  return { fetchCount, reset() { fetchCount = 0; } };
}
