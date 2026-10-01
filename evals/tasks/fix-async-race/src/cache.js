const store = new Map();
let fetchCount = 0;

export async function fetchValue(key) {
  fetchCount++;
  await new Promise(r => setTimeout(r, 20));
  return 'v:' + key;
}

export async function get(key) {
  if (store.has(key)) return store.get(key);
  const value = await fetchValue(key);
  store.set(key, value);
  return value;
}

export function stats() {
  return { fetchCount, reset() { fetchCount = 0; } };
}
