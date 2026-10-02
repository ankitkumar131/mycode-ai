# write-migration-script

**Category:** scripting

Write scripts/migrate.js that reads data.json, renames the field `name` to `fullName` on every record, and writes data.migrated.json. It must be idempotent: running it on already-migrated data must not change the output.
