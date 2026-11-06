export function attach(users, records) {
  const byId = new Map(users.map((u) => [u.id, u.name]));
  const out = [];
  for (const record of records) {
    if (byId.has(record.userId)) out.push({ ...record, user: byId.get(record.userId) });
  }
  return out;
}
