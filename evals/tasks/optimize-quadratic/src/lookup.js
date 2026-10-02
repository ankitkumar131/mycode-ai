export function attach(users, records) {
  const out = [];
  for (const record of records) {
    for (const user of users) {
      if (user.id === record.userId) {
        out.push({ ...record, user: user.name });
      }
    }
  }
  return out;
}
