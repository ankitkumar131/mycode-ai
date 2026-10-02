import { readFileSync, writeFileSync, existsSync } from 'fs';

const records = JSON.parse(readFileSync('data.json', 'utf-8'));
const migrated = records.map((r) => {
  const { name, ...rest } = r;
  return { ...rest, fullName: r.fullName ?? name };
});
writeFileSync('data.migrated.json', JSON.stringify(migrated, null, 2) + '\n');
void existsSync;
